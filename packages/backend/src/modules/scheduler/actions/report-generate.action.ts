import { z } from 'zod'
import { pool, type Queryable } from '../../../db'
import { parseWith } from './action.registry'
import type { ActionHandler } from './action.types'

const configSchema = z.strictObject({
  // Okres raportu wstecz od momentu wykonania.
  periodHours: z.number().int().min(1).max(720).default(24),
})

export type ReportGenerateConfig = z.output<typeof configSchema>

interface TaskStatsRow {
  task_id: string
  title: string
  succeeded: number
  failed: number
  other: number
  avg_duration_ms: number | null
  last_run_at: Date | null
}

/** Raport wykonań schedulera z ostatnich N godzin — przykład akcji bez integracji zewnętrznej. */
export function createReportGenerateAction(db: () => Queryable = () => pool): ActionHandler<ReportGenerateConfig> {
  return {
    type: 'report.generate',
    description: 'Generuje raport wykonań zadań schedulera z zadanego okresu',
    validateConfig: (raw) => parseWith(configSchema, raw ?? {}),

    async execute(context, report) {
      const to = new Date()
      const from = new Date(to.getTime() - report.periodHours * 3600_000)

      const result = await db().query<TaskStatsRow>(
        `SELECT t.id AS task_id, t.title,
                COUNT(*) FILTER (WHERE e.status = 'succeeded')::int AS succeeded,
                COUNT(*) FILTER (WHERE e.status = 'failed')::int AS failed,
                COUNT(*) FILTER (WHERE e.status IN ('pending', 'running'))::int AS other,
                AVG(EXTRACT(EPOCH FROM (e.finished_at - e.started_at)) * 1000)
                  FILTER (WHERE e.finished_at IS NOT NULL)::float AS avg_duration_ms,
                MAX(e.started_at) AS last_run_at
           FROM task_executions e
           JOIN scheduled_tasks t ON t.id = e.task_id
          WHERE e.created_at >= $1 AND e.created_at < $2 AND e.id <> $3
          GROUP BY t.id, t.title
          ORDER BY t.title`,
        [from, to, context.executionId]
      )

      const tasks = result.rows.map((row) => ({
        taskId: row.task_id,
        title: row.title,
        succeeded: row.succeeded,
        failed: row.failed,
        inProgress: row.other,
        avgDurationMs: row.avg_duration_ms === null ? null : Math.round(row.avg_duration_ms),
        lastRunAt: row.last_run_at?.toISOString() ?? null,
      }))
      const totals = tasks.reduce(
        (acc, task) => ({
          succeeded: acc.succeeded + task.succeeded,
          failed: acc.failed + task.failed,
          inProgress: acc.inProgress + task.inProgress,
        }),
        { succeeded: 0, failed: 0, inProgress: 0 }
      )

      context.log(`report: ${tasks.length} task(s), ${totals.succeeded} ok, ${totals.failed} failed`)
      return { from: from.toISOString(), to: to.toISOString(), totals, tasks }
    },
  }
}
