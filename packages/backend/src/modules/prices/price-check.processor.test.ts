import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { CollectorResult } from '@myorg/shared'
import { type CheckNotifier, judgePage, PriceCheckProcessor } from './price-check.processor'
import type { PriceCheckJob, PriceQueue } from './price-queue'
import type { ItemRecord, PricesRepository, SourceRecord } from './prices.repository'

const productHtml = readFileSync(path.join(__dirname, '__fixtures__', 'jsonld.html'), 'utf8')
const definition = { version: 1, strategy: 'auto' } as const

const page = (overrides: Partial<CollectorResult> = {}): CollectorResult => ({
  jobId: 'job-1',
  ok: true,
  httpStatus: 200,
  finalUrl: 'https://shop.test/p/1',
  html: productHtml,
  durationMs: 1500,
  ...overrides,
})

const job = (overrides: Partial<PriceCheckJob> = {}) =>
  ({ id: 'job-1', data: { sourceId: 's1', reason: 'schedule' }, retryCount: 0, retryLimit: 2, ...overrides }) as PriceCheckJob

function setup(sourceOverrides: Partial<SourceRecord> = {}) {
  const calls: [string, ...unknown[]][] = []
  const record =
    (name: string, value?: unknown) =>
    async (...args: unknown[]) => (calls.push([name, ...args]), value)
  const source = {
    id: 's1', itemId: 'i1', label: 'Sklep', url: 'https://shop.test/p/1', enabled: true, definition,
    lastPrice: null, lastAvailable: null, lastTitle: null, consecutiveFailures: 0, failingAlerted: false,
    ...sourceOverrides,
  } as SourceRecord
  const item = { id: 'i1', name: 'Kawiarka', minDropPct: 5, targetPrice: null } as ItemRecord
  const repo = {
    findSource: async () => source,
    findItem: async () => item,
    insertObservation: record('insertObservation'),
    recordSuccess: record('recordSuccess'),
    recordFailure: record('recordFailure'),
    insertSnapshot: record('insertSnapshot'),
    setFailingAlerted: record('setFailingAlerted'),
  } as unknown as PricesRepository
  const queue = {
    enqueue: record('enqueue', 'job-2'),
    complete: record('complete'),
    fail: record('fail'),
  } as unknown as PriceQueue
  const notifier = { notifyOffers: record('notifyOffers'), notifyFailing: record('notifyFailing') } as unknown as CheckNotifier
  const names = () => calls.map(([name]) => name)
  const args = (name: string) => calls.find(([n]) => n === name)?.slice(1)
  return { processor: new PriceCheckProcessor(repo, queue, notifier, async () => []), calls, names, args }
}

describe('judgePage', () => {
  const source = { url: 'https://shop.test/p/1', definition }

  it('reads the price from a product page', () => {
    const verdict = judgePage(page(), source)
    assert.ok('extraction' in verdict)
    assert.equal(verdict.extraction.price, 189.99)
  })

  it('passes on the reason when the collector could not load the page', () => {
    assert.deepEqual(judgePage(page({ ok: false, html: null, httpStatus: null, error: { code: 'TIMEOUT', message: 'Za długo' } }), source), {
      code: 'TIMEOUT',
      message: 'Za długo',
    })
    assert.equal((judgePage(page({ ok: false, html: null }), source) as { code: string }).code, 'NETWORK_ERROR')
  })

  it('tells a block from an ordinary shop error and from a page without a price', () => {
    const code = (result: CollectorResult) => (judgePage(result, source) as { code: string }).code
    assert.equal(code(page({ httpStatus: 403, html: '<html>Access denied</html>' })), 'BLOCKED')
    assert.equal(code(page({ httpStatus: 404, html: '<html>Nie ma takiej strony</html>' })), 'HTTP_ERROR')
    assert.equal(code(page({ finalUrl: 'https://shop.test/Captcha/Add' })), 'BLOCKED')
    assert.equal(code(page({ html: '<title>Just a moment...</title><div id="challenge-platform"></div>' })), 'BLOCKED')
    assert.equal(code(page({ html: '<html><body><h1>Produkt</h1></body></html>' })), 'PRICE_NOT_FOUND')
  })
})

describe('PriceCheckProcessor', () => {
  it('records a successful measurement and completes the job', async () => {
    const { processor, names, args } = setup()
    const outcome = await processor.process(job(), page())
    assert.deepEqual(outcome, { ok: true, price: 189.99, offers: [] })
    assert.deepEqual(names(), ['insertObservation', 'recordSuccess', 'complete'])
    assert.equal((args('insertObservation')?.[1] as { price: number }).price, 189.99)
  })

  it('puts a transient collector failure back in the queue while retries remain', async () => {
    const failed = page({ ok: false, html: null, httpStatus: null, error: { code: 'TIMEOUT', message: 'Za długo' } })
    const first = setup()
    assert.deepEqual(await first.processor.process(job(), failed), { retry: 'TIMEOUT' })
    assert.deepEqual(first.names(), ['fail'])

    const last = setup()
    const outcome = await last.processor.process(job({ retryCount: 2 }), failed)
    assert.deepEqual(outcome, { ok: false, status: 'warning', error: 'Za długo' })
    assert.deepEqual(last.names(), ['insertObservation', 'recordFailure', 'complete'])
  })

  it('marks the source blocked on the third failure in a row, keeps the page and alerts once', async () => {
    const blocked = page({ httpStatus: 403, html: '<html>Access denied</html>' })
    const third = setup({ consecutiveFailures: 2 })
    const outcome = await third.processor.process(job(), blocked)
    assert.deepEqual(outcome, { ok: false, status: 'blocked', error: 'Sklep zablokował pobranie strony (HTTP 403)' })
    assert.deepEqual(third.names(), ['insertObservation', 'recordFailure', 'insertSnapshot', 'setFailingAlerted', 'notifyFailing', 'complete'])

    const alreadyAlerted = setup({ consecutiveFailures: 5, failingAlerted: true })
    await alreadyAlerted.processor.process(job(), blocked)
    assert.ok(!alreadyAlerted.names().includes('notifyFailing'))
  })

  it('confirms a suspicious price change before saving anything', async () => {
    const suspicious = setup({ lastPrice: 1000 })
    assert.deepEqual(await suspicious.processor.process(job(), page()), { suspicious: true, price: 189.99, previous: 1000 })
    assert.deepEqual(suspicious.names(), ['enqueue', 'complete'])
    assert.deepEqual(suspicious.args('enqueue')?.[0], { sourceId: 's1', reason: 'confirm' })

    // The confirming check saves the price even though it still differs that much.
    const confirm = setup({ lastPrice: 1000 })
    const outcome = await confirm.processor.process(job({ data: { sourceId: 's1', reason: 'confirm' } }), page())
    assert.ok('ok' in outcome && outcome.ok)
  })
})
