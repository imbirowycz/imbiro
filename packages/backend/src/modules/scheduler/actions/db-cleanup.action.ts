import { z } from 'zod'
import { pool, type Queryable } from '../../../db'
import { parseWith } from './action.registry'
import type { ActionHandler } from './action.types'

// Periodic database housekeeping. Every target has a fixed, built-in rule — the config only picks
// which targets run (never a table name or SQL), so a task cannot delete anything else.
// The rules are the same ones the app already applies on the fly (e.g. on login): the owning
// modules pass them in (see composition.ts), so this file does not reach into auth or radar.

export const CLEANUP_TARGETS = ['radar_read_items', 'admin_sessions', 'login_attempts', 'task_executions'] as const
export type CleanupTarget = (typeof CLEANUP_TARGETS)[number]

const configSchema = z.strictObject({
  targets: z
    .array(z.enum(CLEANUP_TARGETS))
    .min(1)
    .default([...CLEANUP_TARGETS])
    .refine((targets) => new Set(targets).size === targets.length, 'Duplicate target'),
  /** task_executions: finished runs (succeeded/failed) older than this are deleted. */
  executionsOlderThanDays: z.number().int().min(7).max(3650).default(90),
})

export type DbCleanupConfig = z.output<typeof configSchema>

export interface DbCleanupDeps {
  /** Expired or idle admin sessions (auth). */
  sessions: { deleteExpired(db: Queryable): Promise<number> }
  /** Old login attempts (auth). */
  loginLimiter: { deleteOld(db: Queryable): Promise<number> }
  /** Expired "read" marks (radar). */
  readItems: { deleteExpired(db: Queryable): Promise<number> }
  db?: () => Queryable
}

export function createDbCleanupAction(deps: DbCleanupDeps): ActionHandler<DbCleanupConfig> {
  const { sessions, loginLimiter, readItems } = deps
  const db = deps.db ?? (() => pool)

  const rules: Record<CleanupTarget, (executionId: string, cfg: DbCleanupConfig) => Promise<number>> = {
    // Marks past their own expiry (news: 14 days, alerts: end of the alert + 1 day).
    radar_read_items: () => readItems.deleteExpired(db()),
    // Expired or idle sessions — the same rule as on login.
    admin_sessions: () => sessions.deleteExpired(db()),
    // Login attempts older than a day (the limits look at minutes).
    login_attempts: () => loginLimiter.deleteOld(db()),
    // Finished runs only; pending/running ones and this very run are never touched.
    task_executions: async (executionId, cfg) => {
      const result = await db().query(
        `DELETE FROM task_executions
          WHERE status IN ('succeeded', 'failed')
            AND finished_at < NOW() - make_interval(days => $1)
            AND id <> $2`,
        [cfg.executionsOlderThanDays, executionId]
      )
      return result.rowCount ?? 0
    },
  }

  return {
    type: 'db.cleanup',
    description: 'Czyści bazę: wygasłe oznaczenia radaru i sesje, stare próby logowania i historię wykonań',
    validateConfig: (raw) => parseWith(configSchema, raw ?? {}),

    async execute(context, cfg) {
      const deleted: Partial<Record<CleanupTarget, number>> = {}
      for (const target of cfg.targets) {
        context.signal.throwIfAborted()
        deleted[target] = await rules[target](context.executionId, cfg)
        context.log(`${target}: deleted ${deleted[target]}`)
      }
      const total = Object.values(deleted).reduce((sum, n) => sum + (n ?? 0), 0)
      return { deleted, total }
    },
  }
}
