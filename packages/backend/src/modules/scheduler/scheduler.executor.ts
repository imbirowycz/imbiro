import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { bossDb, JOB_EXPIRE_GRACE_SECONDS, QUEUES } from '../../boss'
import { config } from '../../config'
import { withTransaction } from '../../db'
import { actionRegistry, NonRetryableActionError, type ActionRegistry } from './actions'
import { ExecutionRepository, type ExecutionRecord } from './execution.repository'
import { runAfter } from './schedule'
import { enqueueSlot, type ExecuteJobData, type ScheduledJobData } from './scheduler.planner'
import { SchedulerRepository } from './scheduler.repository'

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
 * Wykonanie jobów z kolejki `scheduler.execute` — wspólne dla terminów z harmonogramu i
 * ręcznych uruchomień. Gwarancja to „co najmniej raz” z deduplikacją po naszej stronie:
 * jeden rekord task_executions na termin i fencing kolejnych prób. Akcja zewnętrzna może
 * zostać wykonana ponownie, jeśli worker padnie po jej wykonaniu, a przed zapisem wyniku.
 */
export class SchedulerExecutor {
  constructor(
    private readonly boss: PgBoss,
    private readonly actions: ActionRegistry = actionRegistry,
    private readonly tasks = new SchedulerRepository(),
    private readonly executions = new ExecutionRepository(),
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
        // Błąd trwały: kończymy job bez ponowień. Ostatnia próba: oddajemy błąd do pg-boss (job = failed).
        if (err instanceof NonRetryableActionError) return { executionId: started.id, status: 'failed' }
        throw err
      }
      // Wróci do kolejki z backoff; do tego czasu rekord czeka jako pending z ostatnim błędem.
      await this.executions.finishAttempt(started.id, attempt, { status: 'pending', error: message })
      console.warn(`${tag} failed, will retry: ${message}`)
      throw err
    }
  }

  /**
   * Przejęcie zaplanowanego terminu. Pod blokadą wiersza zadania: tworzy rekord wykonania,
   * przesuwa next_run_at i dodaje job kolejnego terminu — atomowo. Ponowienie tego samego joba
   * (także po awarii workera) przejmuje istniejący rekord; inny job dla tego terminu jest pomijany.
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
        // Termin przejęty wcześniej przez ten job — dokańczamy go nawet po zmianie harmonogramu.
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
    // Konfigurację czytamy przy każdym wykonaniu — edycja akcji działa od najbliższego terminu.
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
   * Odzyskiwanie po awarii: wykonanie, które utknęło w pending/running, choć jego job w pg-boss
   * już się zakończył (albo zniknął), oznaczamy jako failed. Wykonania, których job wciąż czeka
   * lub będzie ponowiony, zostawiamy — pg-boss dokończy je sam po wygaśnięciu claimu.
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

/** Uruchamia `fn` z limitem czasu; przerywa sygnał przy timeoucie albo gdy pg-boss odbierze job. */
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
