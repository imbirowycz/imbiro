import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSource, type Fetchers } from './price-check'
import { type PageFetcher, PriceFetchError } from './price-fetch'

const html = (price: string) => `<html><body><h1>Kawiarka</h1><span class="p">${price}</span></body></html>`

function fake(kind: 'http' | 'browser', impl: () => string | PriceFetchError): PageFetcher {
  return {
    kind,
    async fetch(url) {
      const result = impl()
      if (result instanceof PriceFetchError) throw result
      return { fetcher: kind, status: 200, finalUrl: url, html: result, durationMs: 1 }
    },
  }
}

const definition = { version: 1 as const, strategy: 'css' as const, price: { selector: '.p' } }

test('auto: http blocked → browser succeeds', async () => {
  const fetchers: Fetchers = {
    http: fake('http', () => new PriceFetchError('BLOCKED', 'blocked', 403)),
    browser: fake('browser', () => html('99,00 zł')),
  }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'auto', definition, fetchers })
  assert.equal(out.ok, true)
  assert.equal(out.fetcher, 'browser')
  assert.equal(out.extraction?.price, 99)
  assert.deepEqual(out.attempts.map((a) => [a.fetcher, a.ok]), [['http', false], ['browser', true]])
})

test('auto: http without price → browser with price', async () => {
  const fetchers: Fetchers = { http: fake('http', () => '<html></html>'), browser: fake('browser', () => html('10 zł')) }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'auto', definition, fetchers })
  assert.equal(out.fetcher, 'browser')
  assert.equal(out.ok, true)
})

test('auto: browser not configured is skipped silently', async () => {
  const fetchers: Fetchers = {
    http: fake('http', () => '<html></html>'),
    browser: fake('browser', () => new PriceFetchError('BROWSER_UNAVAILABLE', 'n/a')),
  }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'auto', definition, fetchers })
  assert.equal(out.ok, false)
  assert.equal(out.error?.code, 'PRICE_NOT_FOUND')
  assert.equal(out.attempts.length, 1)
})

test('http only: error is reported', async () => {
  const fetchers: Fetchers = {
    http: fake('http', () => new PriceFetchError('HTTP_ERROR', 'Sklep zwrócił błąd 404', 404)),
    browser: fake('browser', () => html('1 zł')),
  }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'http', definition, fetchers })
  assert.equal(out.ok, false)
  assert.equal(out.error?.code, 'HTTP_ERROR')
  assert.equal(out.httpStatus, 404)
})

test('preferred browser goes first', async () => {
  const calls: string[] = []
  const fetchers: Fetchers = {
    http: fake('http', () => (calls.push('http'), html('1 zł'))),
    browser: fake('browser', () => (calls.push('browser'), html('2 zł'))),
  }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'auto', preferred: 'browser', definition, fetchers })
  assert.deepEqual(calls, ['browser'])
  assert.equal(out.extraction?.price, 2)
})

test('auto: http without price + browser blocked → BLOCKED (not PRICE_NOT_FOUND)', async () => {
  const fetchers: Fetchers = {
    http: fake('http', () => '<html><title>Strona główna</title></html>'),
    browser: fake('browser', () => new PriceFetchError('BLOCKED', 'captcha', 200)),
  }
  const out = await checkSource({ url: 'https://shop.pl/p', mode: 'auto', definition, fetchers })
  assert.equal(out.ok, false)
  assert.equal(out.error?.code, 'BLOCKED')
  assert.ok(out.page, 'keeps the http page for the debug snapshot')
})
