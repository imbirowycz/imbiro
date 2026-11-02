import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ValidationError } from '../../../errors'
import type { ActionContext } from './action.types'
import { createDbCleanupAction } from './db-cleanup.action'

const context: ActionContext = {
  taskId: '11111111-1111-1111-1111-111111111111',
  taskTitle: 'Sprzątanie',
  executionId: '22222222-2222-2222-2222-222222222222',
  scheduledFor: new Date('2026-11-02T03:00:00Z'),
  trigger: 'schedule',
  attempt: 1,
  signal: new AbortController().signal,
  log: () => {},
}

function setup() {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = { query: async (sql: string, params: unknown[] = []) => (queries.push({ sql, params }), { rowCount: 7 }) }
  const action = createDbCleanupAction({
    db: () => db as never,
    sessions: { deleteExpired: async () => 2 },
    loginLimiter: { deleteOld: async () => 3 },
    readItems: () => ({ deleteExpired: async () => 5 }),
  })
  return { action, queries }
}

describe('db.cleanup', () => {
  it('runs every target by default and reports counts', async () => {
    const { action, queries } = setup()
    const result = await action.execute(context, action.validateConfig({}))
    assert.deepEqual(result, {
      deleted: { radar_read_items: 5, admin_sessions: 2, login_attempts: 3, task_executions: 7 },
      total: 17,
    })
    // Only finished runs older than the default 90 days, never the current execution.
    assert.equal(queries.length, 1)
    assert.match(queries[0].sql, /status IN \('succeeded', 'failed'\)/)
    assert.deepEqual(queries[0].params, [90, context.executionId])
  })

  it('runs only the selected targets', async () => {
    const { action, queries } = setup()
    const result = await action.execute(context, action.validateConfig({ targets: ['radar_read_items'] }))
    assert.deepEqual(result, { deleted: { radar_read_items: 5 }, total: 5 })
    assert.equal(queries.length, 0)
  })

  it('rejects unknown tables, duplicates and too short history', () => {
    const { action } = setup()
    for (const bad of [{ targets: ['users'] }, { targets: [] }, { targets: ['login_attempts', 'login_attempts'] }, { executionsOlderThanDays: 1 }, { sql: 'x' }]) {
      assert.throws(() => action.validateConfig(bad), ValidationError, JSON.stringify(bad))
    }
  })
})
