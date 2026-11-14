import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ActionContext } from '../scheduler'
import type { PriceQueue } from './price-queue'
import { createPriceWatchAction } from './price-watch.action'
import type { PricesRepository, SourceRecord } from './prices.repository'

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-14T07:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000)
const context = { executionId: 'e1', signal: new AbortController().signal, log: () => {} } as unknown as ActionContext

function setup(sources: Partial<SourceRecord>[], item: { enabled: boolean } | null = { enabled: true }) {
  const enqueued: string[] = []
  const action = createPriceWatchAction({
    repo: {
      findItem: async () => (item ? { ...item, jitterMinutes: 0 } : null),
      listSources: async () => sources.map((s, i) => ({ id: `s${i}`, enabled: true, status: 'ok', lastCheckedAt: hoursAgo(5), ...s })),
    } as unknown as PricesRepository,
    queue: { enqueue: async ({ sourceId }: { sourceId: string }) => (enqueued.push(sourceId), 'job') } as unknown as PriceQueue,
    now: () => NOW,
  })
  return { enqueued, run: () => action.execute(context, { itemId: ITEM_ID }) }
}

describe('price.watch', () => {
  it('queues a check for every enabled source', async () => {
    const { enqueued, run } = setup([{}, { enabled: false }, { status: 'failing' }])
    assert.deepEqual(await run(), { sources: 2, enqueued: 2, resting: 0 })
    assert.deepEqual(enqueued.sort(), ['s0', 's2'])
  })

  it('lets a blocked source rest: it is re-checked only when its last check is about a day old', async () => {
    const { enqueued, run } = setup([
      { status: 'blocked', lastCheckedAt: hoursAgo(5) },
      { status: 'blocked', lastCheckedAt: hoursAgo(23.5) },
      { status: 'blocked', lastCheckedAt: null },
    ])
    assert.deepEqual(await run(), { sources: 2, enqueued: 2, resting: 1 })
    assert.deepEqual(enqueued.sort(), ['s1', 's2'])
  })

  it('does nothing for a disabled or deleted item', async () => {
    assert.deepEqual(await setup([{}], { enabled: false }).run(), { skipped: 'item disabled' })
    assert.deepEqual(await setup([{}], null).run(), { skipped: 'item no longer exists' })
  })
})
