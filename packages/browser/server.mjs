import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { isPublicHost } from './ssrf.mjs'

// Serwis przeglądarki dla Łowcy cen. Jedna, stała przeglądarka z zachowanym profilem
// (cookies) i polską lokalizacją — z punktu widzenia sklepu to ciągle ten sam gość.
// Strony renderowane są pojedynczo. Bez wtyczek „stealth” i bez rozwiązywania captchy.
//
// POST /render { url, waitFor?, timeoutMs? } → { status, finalUrl, html } | { error: { code, message } }
// GET  /health

const PORT = Number(process.env.PORT || 3100)
const HOST = process.env.HOST || '0.0.0.0'
const TOKEN = process.env.BROWSER_TOKEN || ''
const PROFILE_DIR = process.env.BROWSER_PROFILE_DIR || path.join(os.tmpdir(), 'imbiro-browser-profile')
const USER_AGENT =
  process.env.BROWSER_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const MAX_HTML = 8 * 1024 * 1024
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font'])
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503])

let contextPromise = null

async function getContext() {
  if (!contextPromise) {
    contextPromise = chromium
      .launchPersistentContext(PROFILE_DIR, {
        // BROWSER_HEADLESS=false: widoczne okno (np. przyszły agent na domowym komputerze).
        headless: process.env.BROWSER_HEADLESS !== 'false',
        // Pełny Chromium w nowym trybie headless (zamiast uproszczonego headless shell).
        channel: process.env.BROWSER_CHANNEL || 'chromium',
        executablePath: process.env.CHROMIUM_PATH || undefined,
        locale: 'pl-PL',
        timezoneId: 'Europe/Warsaw',
        userAgent: USER_AGENT,
        viewport: { width: 1366, height: 860 },
        extraHTTPHeaders: { 'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.6,en;q=0.5' },
        args: ['--disable-dev-shm-usage', '--no-first-run'],
      })
      .then((context) => {
        context.on('close', () => {
          contextPromise = null
        })
        return context
      })
      .catch((err) => {
        contextPromise = null
        throw err
      })
  }
  return contextPromise
}

// Jedna strona naraz: kolejka obietnic.
let queue = Promise.resolve()
function exclusive(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

class RenderError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function render({ url, waitFor, timeoutMs }) {
  let target
  try {
    target = new URL(url)
  } catch {
    throw new RenderError('BLOCKED_URL', 'Nieprawidłowy adres', 400)
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new RenderError('BLOCKED_URL', 'Dozwolone są tylko adresy http(s) bez danych logowania', 400)
  }
  if (!(await isPublicHost(target.hostname))) throw new RenderError('BLOCKED_URL', 'Adres prowadzi do sieci wewnętrznej', 400)

  const budget = Math.min(Math.max(Number(timeoutMs) || 40_000, 5_000), 90_000)
  const deadline = Date.now() + budget
  const context = await getContext()
  const page = await context.newPage()
  try {
    await page.route('**/*', async (route) => {
      const request = route.request()
      try {
        const reqUrl = new URL(request.url())
        if (reqUrl.protocol === 'data:' || reqUrl.protocol === 'blob:') return route.continue()
        if (!['http:', 'https:'].includes(reqUrl.protocol)) return route.abort('blockedbyclient')
        if (BLOCKED_RESOURCES.has(request.resourceType())) return route.abort('blockedbyclient')
        if (!(await isPublicHost(reqUrl.hostname))) return route.abort('blockedbyclient')
        return route.continue()
      } catch {
        return route.abort('failed').catch(() => {})
      }
    })

    // Status ostatniej nawigacji głównej ramki: strony z weryfikacją antybotową najpierw
    // zwracają 403/202/503, a po wykonaniu skryptu przeładowują się do właściwej treści.
    let lastStatus = null
    page.on('response', (r) => {
      try {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) lastStatus = r.status()
      } catch {}
    })

    let response
    try {
      response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: budget })
    } catch (err) {
      if (/Timeout/i.test(String(err?.message))) throw new RenderError('TIMEOUT', 'Strona nie załadowała się na czas', 504)
      throw new RenderError('NETWORK_ERROR', `Nie udało się otworzyć strony: ${String(err?.message ?? err).split('\n')[0]}`)
    }

    const remaining = () => Math.max(500, deadline - Date.now() - 1_000)
    if (CHALLENGE_STATUSES.has(lastStatus ?? response?.status() ?? 200)) {
      // Daj weryfikacji czas na przeładowanie strony.
      await page
        .waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: Math.min(15_000, remaining()) })
        .catch(() => {})
      await page.waitForLoadState('domcontentloaded', { timeout: Math.min(10_000, remaining()) }).catch(() => {})
    }
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: Math.min(20_000, remaining()), state: 'attached' }).catch(() => {})
    } else {
      await page.waitForLoadState('networkidle', { timeout: Math.min(6_000, remaining()) }).catch(() => {})
    }
    // Chwila dla skryptów, które dopisują cenę po załadowaniu.
    await page.waitForTimeout(Math.min(800, remaining()))

    let html = await page.content()
    if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML)
    return { status: lastStatus ?? response?.status() ?? 200, firstStatus: response?.status() ?? null, finalUrl: page.url(), html }
  } finally {
    await page.close().catch(() => {})
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new RenderError('BAD_REQUEST', 'Zbyt duże żądanie', 413)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new RenderError('BAD_REQUEST', 'Niepoprawny JSON', 400)
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, browser: contextPromise ? 'started' : 'idle' })
    if (req.method !== 'POST' || req.url !== '/render') return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } })
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Brak lub zły token' } })
    }
    const body = await readJson(req)
    if (typeof body.url !== 'string') throw new RenderError('BAD_REQUEST', 'Brak url', 400)
    const started = Date.now()
    const result = await exclusive(() => render(body))
    console.log(`render ${result.status} ${Date.now() - started}ms ${body.url}`)
    send(res, 200, result)
  } catch (err) {
    if (err instanceof RenderError) return send(res, err.status, { error: { code: err.code, message: err.message } })
    console.error('render failed', err)
    // Przeglądarka mogła paść — następne żądanie uruchomi ją od nowa.
    contextPromise = null
    send(res, 500, { error: { code: 'BROWSER_UNAVAILABLE', message: 'Błąd przeglądarki' } })
  }
})

server.listen(PORT, HOST, () => console.log(`Browser service listening on ${HOST}:${PORT}`))

async function shutdown() {
  server.close()
  const context = await contextPromise?.catch(() => null)
  await context?.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
