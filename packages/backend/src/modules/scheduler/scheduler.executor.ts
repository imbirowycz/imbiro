import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { bossDb, JOB_EXPIRE_GRACE_SECONDS, QUEUES } from '../../core/boss'
import { config } from '../../core/config'
import { withTransaction } from '../../core/db'
import type { ActionRegistry } from './actions/action.registry'
import { NonRetryableActionError } from './actions/action.types'
import { ExecutionRepository, type ExecutionRecord } from './execution.repository'
import { runAfter } from './schedule.rules'
import { enqueueSlot, type ExecuteJobData, type ScheduledJobData } from './task.queue'
import { TaskRepository } from './task.repository'

export class ActionTimeoutError extends Error {
  constructor(seconds: number) {
    super(`Action timed out after ${seconds}s`)
    this.name = new.target.name
  }
}

export type ProcessOutcome =
  | { executionId: string; status: 'succeeded' | 'failed' | 'retrying' }
  | { skipped: string }

const ACTIVE_JOB_STATES = new Set(['created', 'retry', 'active'])

/**
 * Executes jobs from the `scheduler.execute` queue — shared by scheduled runs and
 * manual runs. The guarantee is "at least once" with deduplication on our side:
 * one task_executions record per run and fencing of later attempts. An external action may
 * run again if the worker dies after performing it but before recording the result.
 */
export class SchedulerExecutor {
  constructor(
    private readonly boss: PgBoss,
    private readonly actions: ActionRegistry,
    private readonly tasks: TaskRepository,
    private readonly executions: ExecutionRepository,
    private readonly timeoutSeconds = config.jobs.timeoutSeconds
  ) {}

  async process(job: JobWithMetadata<ExecuteJobData>): Promise<ProcessOutcome> {
    const execution =
      job.data.trigger === 'schedule'
        ? await this.claimScheduled(job as JobWithMetadata<ScheduledJobData>)
        : await this.claimManual(job.id, job.data.executionId)
    if ('skipped' in execution) return execution

    const attempt = job.retryCount + 1
    const started = await this.executions.startAttempt(execution.id, job.id, attempt)
    if (!started) return { skipped: `attempt ${attempt} of execution ${execution.id} already started or finished` }

    const isLastAttempt = job.retryCount >= job.retryLimit
    const tag = `[task ${job.data.taskId} exec ${execution.id} attempt ${attempt}]`

    try {
      const result = await this.runAction(started, attempt, job.signal, tag)
      await this.executions.finishAttempt(started.id, attempt, { status: 'succeeded', result })
      console.log(`${tag} succeeded`)
      return { executionId: started.id, status: 'succeeded' }
    } catch (err) {
      const message = errorMessage(err)
      if (err instanceof NonRetryableActionError || isLastAttempt) {
        await this.executions.finishAttempt(started.id, attempt, { status: 'failed', error: message })
        console.error(`${tag} failed: ${message}`)
        // Permanent error: finish the job without retries. Last attempt: hand the error to pg-boss (job = failed).
        if (err instanceof NonRetryableActionError) return { executionId: started.id, status: 'failed' }
        throw err
      }
      // It returns to the queue with backoff; until then the record waits as pending with the last error.
      await this.executions.finishAttempt(started.id, attempt, { status: 'pending', error: message })
      console.warn(`${tag} failed, will retry: ${message}`)
      throw err
    }
  }

  /**
   * Claims a scheduled run. Under the task row lock: creates the execution record,
   * advances next_run_at and enqueues the job of the next run — atomically. A retry of the same job
   * (also after a worker crash) takes over the existing record; another job for this run is skipped.
   */
  private async claimScheduled(job: JobWithMetadata<ScheduledJobData>): Promise<ExecutionRecord | { skipped: string }> {
    const slot = new Date(job.data.scheduledFor)

    return withTransaction(async (client) => {
      const task = await this.tasks.findById(job.data.taskId, client, { forUpdate: true })
      if (!task) return { skipped: 'task no longer exists' }

      const existing = await this.executions.findScheduled(task.id, slot, client)
      if (existing) {
        if (existing.jobId !== job.id) return { skipped: `slot already handled by job ${existing.jobId}` }
        if (existing.status === 'succeeded' || existing.status === 'failed') return { skipped: 'slot already finished' }
        // Run claimed earlier by this job — finish it even if the schedule has changed since.
        return existing
      }

      if (!task.enabled || task.scheduleVersion !== job.data.scheduleVersion) {
        return { skipped: 'stale job: task disabled or schedule changed' }
      }
      if (task.nextRunAt?.getTime() !== slot.getTime()) {
        return { skipped: 'stale job: slot is not the next run of the task' }
      }

      const execution = await this.executions.insertScheduled(task.id, slot, job.id, client)
      if (!execution) return { skipped: 'slot already claimed' }

      const advanced = await this.tasks.update(task.id, { ...task, nextRunAt: runAfter(task, slot, new Date()) }, client)
      await enqueueSlot(this.boss, advanced, bossDb(client))
      return execution
    })
  }

  private async claimManual(jobId: string, executionId: string): Promise<ExecutionRecord | { skipped: string }> {
    const execution = await this.executions.findById(executionId)
    if (!execution) return { skipped: 'execution no longer exists' }
    if (execution.jobId !== jobId) return { skipped: `execution belongs to job ${execution.jobId}` }
    if (execution.status === 'succeeded' || execution.status === 'failed') return { skipped: 'execution already finished' }
    return execution
  }

  private async runAction(execution: ExecutionRecord, attempt: number, jobSignal: AbortSignal, tag: string) {
    // The config is read on every execution — an edited action takes effect from the next run.
    const task = await this.tasks.findById(execution.taskId)
    if (!task) throw new NonRetryableActionError('Task no longer exists')
    if (!this.actions.has(task.actionType)) {
      throw new NonRetryableActionError(`Unknown action type "${task.actionType}"`)
    }
    const handler = this.actions.get(task.actionType)

    let actionConfig: unknown
    try {
      actionConfig = handler.validateConfig(task.actionConfig)
    } catch (err) {
      throw new NonRetryableActionError(`Invalid action config: ${errorMessage(err)}`)
    }

    return withTimeout(this.timeoutSeconds, jobSignal, (signal) =>
      handler.execute(
        {
          taskId: task.id,
          taskTitle: task.title,
          executionId: execution.id,
          scheduledFor: execution.scheduledFor,
          trigger: execution.trigger,
          attempt,
          signal,
          log: (message) => console.log(`${tag} ${message}`),
        },
        actionConfig
      )
    )
  }

  /**
   * Crash recovery: an execution stuck in pending/running although its pg-boss job
   * has already ended (or is gone) is marked as failed. Executions whose job still waits
   * or will be retried are left alone — pg-boss finishes them itself once the claim expires.
   */
  async recoverInterrupted(): Promise<number> {
    const staleAfterSeconds = this.timeoutSeconds + JOB_EXPIRE_GRACE_SECONDS + 60
    let recovered = 0

    for (const execution of await this.executions.findStale(staleAfterSeconds)) {
      let reason = 'no job attached'
      if (execution.jobId) {
        const [job] = await this.boss.findJobs(QUEUES.execute, { id: execution.jobId })
        if (job && ACTIVE_JOB_STATES.has(job.state)) continue
        reason = job ? `job ended as ${job.state}` : 'job no longer exists'
      }
      if (await this.executions.failUnfinished(execution.id, `Execution interrupted (${reason}) without recording a result`)) {
        console.warn(`Recovered interrupted execution ${execution.id}: ${reason}`)
        recovered++
      }
    }
    return recovered
  }
}

/** Runs `fn` with a time limit; aborts the signal on timeout or when pg-boss takes the job away. */
async function withTimeout<T>(seconds: number, parent: AbortSignal, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, parent])
  let timer: NodeJS.Timeout | undefined
  let onParentAbort: (() => void) | undefined

  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new ActionTimeoutError(seconds)
      controller.abort(err)
      reject(err)
    }, seconds * 1000)
    onParentAbort = () => reject(new Error('Worker stopped or lost the job before the action finished'))
    if (parent.aborted) onParentAbort()
    else parent.addEventListener('abort', onParentAbort, { once: true })
  })

  try {
    return await Promise.race([fn(signal), interrupted])
  } finally {
    clearTimeout(timer)
    if (onParentAbort) parent.removeEventListener('abort', onParentAbort)
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.slice(0, 2000)
}
