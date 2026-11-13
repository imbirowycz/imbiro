import type { ExecutionStatus, ExecutionTrigger, TaskExecution } from '@myorg/shared'
import { pool, type Queryable } from '../../db'

interface ExecutionRow {
  id: string
  task_id: string
  trigger: ExecutionTrigger
  status: ExecutionStatus
  scheduled_for: Date
  started_at: Date | null
  finished_at: Date | null
  attempts: number
  error: string | null
  result: unknown
  job_id: string | null
  created_at: Date
  updated_at: Date
}

export interface ExecutionRecord {
  id: string
  taskId: string
  trigger: ExecutionTrigger
  status: ExecutionStatus
  scheduledFor: Date
  startedAt: Date | null
  finishedAt: Date | null
  attempts: number
  error: string | null
  result: unknown
  jobId: string | null
  createdAt: Date
  updatedAt: Date
}

function toRecord(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attempts: row.attempts,
    error: row.error,
    result: row.result,
    jobId: row.job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toExecutionDto(execution: ExecutionRecord): TaskExecution {
  return {
    id: execution.id,
    taskId: execution.taskId,
    trigger: execution.trigger,
    status: execution.status,
    scheduledFor: execution.scheduledFor.toISOString(),
    startedAt: execution.startedAt?.toISOString() ?? null,
    finishedAt: execution.finishedAt?.toISOString() ?? null,
    attempts: execution.attempts,
    error: execution.error,
    result: execution.result,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  }
}

export class ExecutionRepository {
  async findById(id: string, db: Queryable = pool): Promise<ExecutionRecord | null> {
    const result = await db.query<ExecutionRow>('SELECT * FROM task_executions WHERE id = $1', [id])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async findScheduled(taskId: string, scheduledFor: Date, db: Queryable = pool): Promise<ExecutionRecord | null> {
    const result = await db.query<ExecutionRow>(
      `SELECT * FROM task_executions WHERE task_id = $1 AND scheduled_for = $2 AND trigger = 'schedule'`,
      [taskId, scheduledFor]
    )
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async listByTask(taskId: string, limit: number, db: Queryable = pool): Promise<ExecutionRecord[]> {
    const result = await db.query<ExecutionRow>(
      'SELECT * FROM task_executions WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2',
      [taskId, limit]
    )
    return result.rows.map(toRecord)
  }

  /**
   * Record for a scheduled run. The unique index (task_id, scheduled_for) guarantees that
   * in a race only one job creates it — the others get null.
   */
  async insertScheduled(taskId: string, scheduledFor: Date, jobId: string, db: Queryable = pool): Promise<ExecutionRecord | null> {
    const result = await db.query<ExecutionRow>(
      `INSERT INTO task_executions (task_id, trigger, status, scheduled_for, job_id)
       VALUES ($1, 'schedule', 'pending', $2, $3)
       ON CONFLICT (task_id, scheduled_for) WHERE trigger = 'schedule' DO NOTHING
       RETURNING *`,
      [taskId, scheduledFor, jobId]
    )
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  async insertManual(taskId: string, scheduledFor: Date, jobId: string, db: Queryable = pool): Promise<ExecutionRecord> {
    const result = await db.query<ExecutionRow>(
      `INSERT INTO task_executions (task_id, trigger, status, scheduled_for, job_id)
       VALUES ($1, 'manual', 'pending', $2, $3)
       RETURNING *`,
      [taskId, scheduledFor, jobId]
    )
    return toRecord(result.rows[0])
  }

  /**
   * Start of an attempt. The condition on job_id and status means the execution is taken over only
   * by the job that owns it (including its retry after a worker crash) and only while
   * the execution has not finished. Returns null when the attempt cannot start.
   */
  async startAttempt(id: string, jobId: string, attempt: number, db: Queryable = pool): Promise<ExecutionRecord | null> {
    const result = await db.query<ExecutionRow>(
      `UPDATE task_executions
          SET status = 'running', started_at = NOW(), attempts = $3, error = NULL
        WHERE id = $1 AND job_id = $2 AND status IN ('pending', 'running') AND attempts < $3
        RETURNING *`,
      [id, jobId, attempt]
    )
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  /**
   * Records the result of an attempt. `attempts = $attempt` is a fencing token: a late attempt (e.g. after
   * a timeout, when the next one is already running) cannot overwrite newer state. Returns false when nothing was written.
   */
  async finishAttempt(
    id: string,
    attempt: number,
    outcome:
      | { status: 'succeeded'; result: unknown }
      | { status: 'failed'; error: string }
      | { status: 'pending'; error: string },
    db: Queryable = pool
  ): Promise<boolean> {
    const final = outcome.status !== 'pending'
    const result = await db.query(
      `UPDATE task_executions
          SET status = $3,
              finished_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
              result = $5,
              error = $6
        WHERE id = $1 AND attempts = $2 AND status = 'running'`,
      [
        id,
        attempt,
        outcome.status,
        final,
        outcome.status === 'succeeded' ? JSON.stringify(outcome.result ?? null) : null,
        outcome.status === 'succeeded' ? null : outcome.error,
      ]
    )
    return (result.rowCount ?? 0) > 0
  }

  /** Marks an unfinished execution as failed (crash recovery). */
  async failUnfinished(id: string, error: string, db: Queryable = pool): Promise<boolean> {
    const result = await db.query(
      `UPDATE task_executions
          SET status = 'failed', finished_at = NOW(), started_at = COALESCE(started_at, NOW()), error = $2
        WHERE id = $1 AND status IN ('pending', 'running')`,
      [id, error]
    )
    return (result.rowCount ?? 0) > 0
  }

  /** Unfinished executions unchanged for `olderThanSeconds` — candidates for a job state check. */
  async findStale(olderThanSeconds: number, limit = 100, db: Queryable = pool): Promise<ExecutionRecord[]> {
    const result = await db.query<ExecutionRow>(
      `SELECT * FROM task_executions
        WHERE status IN ('pending', 'running') AND updated_at < NOW() - make_interval(secs => $1)
        ORDER BY updated_at
        LIMIT $2`,
      [olderThanSeconds, limit]
    )
    return result.rows.map(toRecord)
  }
}
