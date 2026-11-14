import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CollectorJob, CollectorResult, CollectorSettings } from '@myorg/shared'
import { Collector } from './collector'
import { BlockedUrlError } from './ip-guard'

const settings: CollectorSettings = { pollSeconds: 20, domainGapMinSeconds: 30, domainGapMaxSeconds: 90, pageTimeoutSeconds: 45, maxJobsPerClaim: 3 }
const job = (jobId: string, url: string): CollectorJob => ({ jobId, url })

function setup(jobs: CollectorJob[], load: (url: string) => Promise<{ httpStatus: number | null; finalUrl: string; html: string }>) {
  const reported: CollectorResult[] = []
  const sleeps: number[] = []
  const closes = { count: 0 }
  let clock = 1_000_000
  const collector = new Collector({
    api: {
      claim: async () => ({ settings, jobs }),
      report: async (result) => void reported.push(result),
    },
    loader: { load: (url) => load(url), close: async () => void closes.count++ },
    assertAllowed: async (url) => {
      if (url.includes('192.168.')) throw new BlockedUrlError('Adres prowadzi do sieci prywatnej')
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    random: () => 0.5,
    log: () => {},
  })
  return { collector, reported, sleeps, closes }
}

const okPage = async (url: string) => ({ httpStatus: 200, finalUrl: url, html: '<html>ok</html>' })
const signal = new AbortController().signal

describe('Collector.cycle', () => {
  it('fetches every claimed page and reports it, returning the server limits', async () => {
    const { collector, reported } = setup([job('a', 'https://shop-a.test/p'), job('b', 'https://shop-b.test/p')], okPage)
    assert.deepEqual(await collector.cycle(signal), settings)
    assert.deepEqual(
      reported.map((r) => [r.jobId, r.ok, r.httpStatus, r.html]),
      [['a', true, 200, '<html>ok</html>'], ['b', true, 200, '<html>ok</html>']]
    )
  })

  it('closes the browser when the queue is drained, keeps it open while a full batch suggests more work', async () => {
    const drained = setup([job('a', 'https://shop-a.test/p')], okPage)
    await drained.collector.cycle(signal)
    assert.equal(drained.closes.count, 1)

    const idle = setup([], okPage)
    await idle.collector.cycle(signal)
    assert.equal(idle.closes.count, 1)

    const full = setup([job('a', 'https://a.test/'), job('b', 'https://b.test/'), job('c', 'https://c.test/')], okPage)
    await full.collector.cycle(signal)
    assert.equal(full.closes.count, 0)
  })

  it('waits a random gap from the server-set range between two pages of one domain only', async () => {
    const { collector, sleeps } = setup(
      [job('a', 'https://www.shop.test/1'), job('b', 'https://other.test/1'), job('c', 'https://shop.test/2')],
      okPage
    )
    await collector.cycle(signal)
    // random 0.5 of the 30–90 s range
    assert.deepEqual(sleeps, [60_000])
  })

  it('reports a blocked page (HTTP 403) as loaded — the server judges what it means', async () => {
    const { collector, reported } = setup([job('a', 'https://shop.test/p')], async (url) => ({ httpStatus: 403, finalUrl: url, html: 'denied' }))
    await collector.cycle(signal)
    assert.equal(reported[0].ok, true)
    assert.equal(reported[0].httpStatus, 403)
  })

  it('never opens a private address and discards a page that redirected into one', async () => {
    const loaded: string[] = []
    const { collector, reported } = setup([job('a', 'https://192.168.1.1/admin'), job('b', 'https://shop.test/p')], async (url) => {
      loaded.push(url)
      return { httpStatus: 200, finalUrl: 'https://192.168.0.10/secret', html: 'secret' }
    })
    await collector.cycle(signal)
    assert.deepEqual(loaded, ['https://shop.test/p'])
    assert.deepEqual(reported.map((r) => [r.ok, r.html, r.error?.code]), [[false, null, 'BLOCKED_URL'], [false, null, 'BLOCKED_URL']])
  })

  it('maps a page timeout, another failure and an oversized page to error codes', async () => {
    const pages: Record<string, () => Promise<{ httpStatus: number; finalUrl: string; html: string }>> = {
      'https://slow.test/': async () => {
        throw new Error('page.goto: Timeout 45000ms exceeded.\nCall log: …')
      },
      'https://down.test/': async () => {
        throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://down.test/')
      },
      'https://huge.test/': async () => ({ httpStatus: 200, finalUrl: 'https://huge.test/', html: 'x'.repeat(7 * 1024 * 1024) }),
    }
    const { collector, reported } = setup(Object.keys(pages).map((url, i) => job(String(i), url)), (url) => pages[url]())
    await collector.cycle(signal)
    assert.deepEqual(reported.map((r) => r.error?.code), ['TIMEOUT', 'NETWORK_ERROR', 'TOO_LARGE'])
  })
})

describe('Collector.run', () => {
  it('survives an unreachable API, backs off and continues', async () => {
    const stop = new AbortController()
    const sleeps: number[] = []
    let calls = 0
    const collector = new Collector({
      api: {
        claim: async () => {
          if (++calls <= 2) throw new Error('fetch failed')
          return { settings, jobs: [] }
        },
        report: async () => {},
      },
      loader: { load: okPage, close: async () => {} },
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length === 3) stop.abort()
      },
      log: () => {},
    })
    await collector.run(stop.signal)
    assert.deepEqual(sleeps, [10_000, 20_000, 20_000])
  })
})
