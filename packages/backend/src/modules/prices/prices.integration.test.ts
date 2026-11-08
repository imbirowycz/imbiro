import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { PgBoss } from 'pg-boss'
import type { Pool } from 'pg'
import { createBoss, ensureQueues } from '../../boss'
import { pool as dbPool } from '../../db'
import { runMigrations } from '../../migrate'
import { SchedulerService } from '../scheduler/scheduler.service'
import { bindPriceQueue } from './price-queue'
import { PricesService } from './prices.service'

// Test na prawdziwej bazie — uruchamiany tylko z PRICES_INTEGRATION=1 (np. lokalnie z `npm run up`):
//   PRICES_INTEGRATION=1 DATABASE_URL=postgres://user:password@localhost:5432/app npm test
const enabled = process.env.PRICES_INTEGRATION === '1'

let boss: PgBoss
let service: PricesService
const pool: Pool = dbPool

const definition = { version: 1, strategy: 'auto' }
const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Test: Bialetti Moka Express 6 tz',
  minDropPct: 5,
  notify: { telegram: false, telegramChatId: null, email: false, emailTo: null },
  schedule: { kind: 'cron', cron: '0 7,12,19 * * *', jitterMinutes: 30 },
  sources: [
    { label: 'Sklep A', url: 'https://sklep-a.example.com/p/1', fetchMode: 'auto', definition },
    { label: 'Sklep B', url: 'https://sklep-b.example.com/p/1', fetchMode: 'http', definition },
  ],
  ...overrides,
})

before(async () => {
  if (!enabled) return
  await runMigrations()
  boss = createBoss('api')
  await boss.start()
  await ensureQueues(boss)
  bindPriceQueue(boss)
  service = new PricesService(new SchedulerService(boss))
})

after(async () => {
  if (enabled) await boss.stop({ graceful: false })
  await pool.end()
})

test('create → update → delete leaves no trace', { skip: !enabled }, async () => {
  const created = await service.create(body())
  assert.equal(created.sources.length, 2)
  assert.equal(created.schedule.kind, 'cron')
  assert.equal(created.schedule.cron, '0 7,12,19 * * *')
  assert.ok(created.nextRunAt)
  const task = await pool.query('SELECT action_type, action_config, timezone FROM scheduled_tasks WHERE id = $1', [created.scheduledTaskId])
  assert.equal(task.rows[0].action_type, 'price.watch')
  assert.equal(task.rows[0].action_config.itemId, created.id)
  assert.equal(task.rows[0].timezone, 'Europe/Warsaw')

  const [a] = created.sources
  // Dane „historyczne”, które muszą zniknąć razem z artykułem.
  await pool.query("INSERT INTO price_observations (source_id, ok, price) VALUES ($1, true, 189.99)", [a.id])
  await pool.query(
    "INSERT INTO price_offers (item_id, source_id, kind, title, url, price) VALUES ($1, $2, 'price_drop', 't', 'https://x', 150)",
    [created.id, a.id]
  )
  await pool.query("INSERT INTO price_debug_snapshots (source_id, html) VALUES ($1, '<html>')", [a.id])
  await pool.query("INSERT INTO task_executions (task_id, trigger, scheduled_for) VALUES ($1, 'manual', NOW())", [created.scheduledTaskId])

  // Edycja: zmiana harmonogramu, usunięcie źródła B, nazwa źródła A bez zmiany adresu.
  const updated = await service.update(
    created.id,
    body({
      schedule: { kind: 'interval', everyHours: 6, jitterMinutes: 0 },
      sources: [{ id: a.id, label: 'Sklep A (nowa nazwa)', url: a.url, fetchMode: 'auto', definition }],
    })
  )
  assert.equal(updated.sources.length, 1)
  assert.equal(updated.sources[0].id, a.id)
  assert.equal(updated.sources[0].label, 'Sklep A (nowa nazwa)')
  assert.deepEqual(updated.schedule, { kind: 'interval', everyHours: 6, jitterMinutes: 0 })

  const disabled = await service.setEnabled(created.id, false)
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.nextRunAt, null)

  await service.delete(created.id)
  for (const [table, column, id] of [
    ['price_items', 'id', created.id],
    ['price_sources', 'item_id', created.id],
    ['price_observations', 'source_id', a.id],
    ['price_offers', 'item_id', created.id],
    ['price_debug_snapshots', 'source_id', a.id],
    ['scheduled_tasks', 'id', created.scheduledTaskId],
    ['task_executions', 'task_id', created.scheduledTaskId],
  ] as const) {
    const left = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])
    assert.equal(left.rows[0].n, 0, `${table} still has rows`)
  }
  await assert.rejects(service.get(created.id), /nie istnieje/)
})

test('validation: enabled channel requires address, css requires price selector', { skip: !enabled }, async () => {
  await assert.rejects(
    service.create(body({ notify: { telegram: true, telegramChatId: '', email: false, emailTo: null } })),
    (err: { details?: { path: string }[] }) => !!err.details?.some((d) => d.path === 'notify.telegramChatId')
  )
  await assert.rejects(
    service.create(body({ sources: [{ label: 'X', url: 'https://x.example.com', fetchMode: 'auto', definition: { version: 1, strategy: 'css' } }] })),
    (err: { details?: { path: string }[] }) => !!err.details?.some((d) => d.path === 'sources.0.definition.price')
  )
})

// ---------- worker ----------

import type { CheckOutcome } from './price-check'
import { PriceCheckWorker, type CheckHooks } from './price-worker'

function okOutcome(price: number, extra: Partial<NonNullable<CheckOutcome['extraction']>> = {}): CheckOutcome {
  return {
    ok: true,
    fetcher: 'http',
    httpStatus: 200,
    finalUrl: 'https://sklep-a.example.com/p/1',
    durationMs: 5,
    extraction: { title: 'Bialetti Moka Express 6 tz', price, oldPrice: null, currency: 'PLN', available: true, strategyUsed: 'jsonld', warnings: [], ...extra },
    comparison: [],
    selectorMatches: [],
    attempts: [],
    error: null,
    page: { fetcher: 'http', status: 200, finalUrl: 'https://sklep-a.example.com/p/1', html: '<html></html>', durationMs: 5 },
  }
}

function failOutcome(code: 'BLOCKED' | 'PRICE_NOT_FOUND' | 'NETWORK_ERROR'): CheckOutcome {
  return {
    ...okOutcome(0),
    ok: false,
    extraction: null,
    error: { code, message: code },
    page: code === 'PRICE_NOT_FOUND' ? { fetcher: 'http', status: 200, finalUrl: 'x', html: '<html>no price</html>', durationMs: 1 } : null,
  }
}

export function fakeJob(sourceId: string, reason: 'schedule' | 'now' | 'confirm' = 'now', retryCount = 0) {
  return { id: 'job', data: { sourceId, reason }, retryCount, retryLimit: 2, signal: new AbortController().signal } as never
}

export function workerWith(outcomes: CheckOutcome[], hooks: CheckHooks = {}) {
  return new PriceCheckWorker(hooks, undefined, async () => outcomes.shift() as CheckOutcome, 0)
}

test('worker: success, failures → warning → failing (one alert), snapshot, recovery', { skip: !enabled }, async () => {
  const item = await service.create(body({ sources: [{ label: 'A', url: 'https://sklep-a.example.com/p/1', fetchMode: 'auto', definition }] }))
  const sourceId = item.sources[0].id
  const alerts: string[] = []
  const worker = workerWith(
    [okOutcome(199), failOutcome('PRICE_NOT_FOUND'), failOutcome('PRICE_NOT_FOUND'), failOutcome('PRICE_NOT_FOUND'), failOutcome('PRICE_NOT_FOUND'), okOutcome(189)],
    { onFailing: async (_i, s, status) => void alerts.push(`${s.label}:${status}`) }
  )
  const statusOf = async () => (await service.get(item.id)).sources[0]

  await worker.process(fakeJob(sourceId))
  assert.equal((await statusOf()).status, 'ok')
  assert.equal((await statusOf()).lastPrice, 199)

  await worker.process(fakeJob(sourceId))
  assert.equal((await statusOf()).status, 'warning')
  await worker.process(fakeJob(sourceId))
  await worker.process(fakeJob(sourceId))
  assert.equal((await statusOf()).status, 'failing')
  await worker.process(fakeJob(sourceId))
  assert.deepEqual(alerts, ['A:failing'], 'alert only once')
  const snaps = await pool.query('SELECT COUNT(*)::int AS n FROM price_debug_snapshots WHERE source_id = $1', [sourceId])
  assert.equal(snaps.rows[0].n, 3, 'keeps last 3 snapshots')

  await worker.process(fakeJob(sourceId))
  const recovered = await statusOf()
  assert.equal(recovered.status, 'ok')
  assert.equal(recovered.consecutiveFailures, 0)
  assert.equal(recovered.lastPrice, 189)
  const history = await service.history(sourceId)
  assert.equal(history.length, 6)
  await service.delete(item.id)
})

test('worker: transient errors retry, deleted source is skipped', { skip: !enabled }, async () => {
  const item = await service.create(body({ sources: [{ label: 'A', url: 'https://sklep-a.example.com/p/1', fetchMode: 'auto', definition }] }))
  const sourceId = item.sources[0].id
  const worker = workerWith([failOutcome('NETWORK_ERROR')])
  await assert.rejects(worker.process(fakeJob(sourceId, 'now', 0)), /NETWORK_ERROR/)
  assert.equal((await service.get(item.id)).sources[0].status, 'untested', 'no failure recorded before last retry')
  await service.delete(item.id)
  assert.deepEqual(await workerWith([]).process(fakeJob(sourceId)), { skipped: 'source no longer exists' })
})
