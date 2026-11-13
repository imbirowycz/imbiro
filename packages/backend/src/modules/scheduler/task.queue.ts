import type { PgBoss, Db } from 'pg-boss'
import { QUEUES } from '../../boss'
import type { TaskRecord } from './task.repository'

// Schedule ↔ pg-boss integration: one planned run of a task = one job in the queue.

export interface ScheduledJobData {
  trigger: 'schedule'
  taskId: string
  /** ISO time of the run this job is for. */
  scheduledFor: string
  /** Schedule version at planning time; a job with an older version is skipped. */
  scheduleVersion: number
}

export interface ManualJobData {
  trigger: 'manual'
  taskId: string
  /** The task_executions record created together with the job. */
  executionId: string
}

export type ExecuteJobData = ScheduledJobData | ManualJobData

/**
 * Key of a run. The queue has the `exclusive` policy, so pg-boss rejects a second job
 * with the same key while the first one waits or runs — this protects against planning
 * a run twice (e.g. a concurrent edit and reconcile).
 */
export function slotKey(task: TaskRecord): string | null {
  if (!task.enabled || !task.nextRunAt) return null
  return `${task.id}:${task.scheduleVersion}:${task.nextRunAt.toISOString()}`
}

/** Adds a job for the task's current run. Returns the job id or null (no run / already queued). */
export async function enqueueSlot(boss: PgBoss, task: TaskRecord, db?: Db): Promise<string | null> {
  const key = slotKey(task)
  if (!key || !task.nextRunAt) return null

  const data: ScheduledJobData = {
    trigger: 'schedule',
    taskId: task.id,
    scheduledFor: task.nextRunAt.toISOString(),
    scheduleVersion: task.scheduleVersion,
  }
  return boss.send(QUEUES.execute, data, { singletonKey: key, startAfter: task.nextRunAt, db })
}

/**
 * Job of a manual run — the same queue and the same executor as scheduled runs.
 * We assign the job id ourselves to store it in the execution record in the same transaction.
 * The key is required: with the `exclusive` policy jobs without a key would block each other.
 */
export async function enqueueManualRun(
  boss: PgBoss,
  taskId: string,
  executionId: string,
  jobId: string,
  db?: Db
): Promise<void> {
  const data: ManualJobData = { trigger: 'manual', taskId, executionId }
  const id = await boss.send(QUEUES.execute, data, { id: jobId, singletonKey: `manual:${executionId}`, db })
  if (!id) throw new Error(`Failed to enqueue manual run ${executionId}`)
}

/** Cancels the waiting job of the previous run. A missing job is not an error. */
export async function cancelSlot(boss: PgBoss, task: TaskRecord, db?: Db): Promise<void> {
  const key = slotKey(task)
  if (!key) return

  const jobs = await boss.findJobs(QUEUES.execute, { key, queued: true, db })
  if (jobs.length > 0) {
    await boss.cancel(QUEUES.execute, jobs.map((job) => job.id), { db })
  }
}

/**
 * Brings the queue in line with the task after a change. Cancelling the old job is
 * housekeeping — even if it failed, the worker would skip the job by `scheduleVersion`.
 */
export async function syncSlot(
  boss: PgBoss,
  previous: TaskRecord | null,
  current: TaskRecord,
  db?: Db
): Promise<void> {
  const previousKey = previous ? slotKey(previous) : null
  const currentKey = slotKey(current)
  if (previousKey === currentKey) return

  if (previous) await cancelSlot(boss, previous, db)
  await enqueueSlot(boss, current, db)
}
