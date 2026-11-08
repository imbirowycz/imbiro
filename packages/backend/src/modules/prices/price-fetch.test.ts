import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertFetchableUrl, createHttpFetcher, PriceFetchError } from './price-fetch'

function response(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
}

test('assertFetchableUrl rejects non-http, credentials, odd ports and local names', () => {
  for (const url of ['ftp://a.pl', 'https://u:p@a.pl', 'https://a.pl:8080', 'http://localhost/x', 'nope']) {
    assert.throws(() => assertFetchableUrl(url), PriceFetchError, url)
  }
  assert.equal(assertFetchableUrl('https://sklep.pl/p?id=1').hostname, 'sklep.pl')
})

test('http fetcher follows redirects, keeps cookies and detects blocks', async () => {
  const seen: { url: string; cookie: string | null }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    seen.push({ url, cookie: headers.Cookie ?? null })
    if (url.endsWith('/a')) return response(302, '', { location: '/b', 'set-cookie': 'sid=1; Path=/' })
    if (url.endsWith('/b')) return response(200, '<h1>ok</h1>')
    return response(403, 'Access denied')
  }) as unknown as typeof fetch
  const fetcher = createHttpFetcher(fetchImpl, 'UA')
  const page = await fetcher.fetch('https://shop.pl/a', { signal: new AbortController().signal })
  assert.equal(page.finalUrl, 'https://shop.pl/b')
  assert.equal(page.html, '<h1>ok</h1>')
  assert.equal(seen[1].cookie, 'sid=1')

  await assert.rejects(fetcher.fetch('https://shop.pl/c', { signal: new AbortController().signal }), (err: PriceFetchError) => err.code === 'BLOCKED')
})

test('http fetcher refuses redirect to a local address', async () => {
  const fetchImpl = (async () => response(301, '', { location: 'http://localhost/admin' })) as unknown as typeof fetch
  const fetcher = createHttpFetcher(fetchImpl, 'UA')
  await assert.rejects(fetcher.fetch('https://shop.pl/a', { signal: new AbortController().signal }), (err: PriceFetchError) => err.code === 'BLOCKED_URL')
})

test('redirect to a captcha page is a block', async () => {
  const fetchImpl = (async (url: string) =>
    url.includes('/Captcha/') ? response(200, '<html>prove you are human</html>') : response(302, '', { location: '/Captcha/Add?ReturnUrl=%2F1' })) as unknown as typeof fetch
  const fetcher = createHttpFetcher(fetchImpl, 'UA')
  await assert.rejects(fetcher.fetch('https://www.ceneo.pl/1', { signal: new AbortController().signal }), (err: PriceFetchError) => err.code === 'BLOCKED')
})
