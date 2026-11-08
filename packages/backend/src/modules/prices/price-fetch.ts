import type { PriceErrorCode, PriceFetcher } from '@myorg/shared'
import { config } from '../../config'
import { decodeBody } from '../radar/http/safe-fetch'
import { createGuardedFetch } from '../radar/reader/ssrf-guard'
import { looksBlocked } from './price-html'

// Pobieranie stron produktów: zwykłe zapytanie (http) albo prawdziwa przeglądarka (browser).
// Adresy są dowolne (wpisuje je użytkownik), więc zamiast listy dozwolonych hostów działa
// ochrona SSRF: połączenia tylko z publicznymi adresami IP, także po przekierowaniach.

export interface FetchedPage {
  fetcher: PriceFetcher
  status: number
  finalUrl: string
  html: string
  durationMs: number
}

export class PriceFetchError extends Error {
  constructor(
    readonly code: PriceErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly retryable = false
  ) {
    super(message)
    this.name = 'PriceFetchError'
  }
}

export interface FetchOptions {
  signal: AbortSignal
  /** Tylko przeglądarka: czekaj na selektor (np. cenę ładowaną JavaScriptem). */
  waitFor?: string
}

export interface PageFetcher {
  readonly kind: PriceFetcher
  fetch(url: string, options: FetchOptions): Promise<FetchedPage>
}

const MAX_BYTES = 6 * 1024 * 1024
const MAX_REDIRECTS = 5

/** Przekierowanie na stronę captchy (np. ceneo.pl/Captcha/Add) to blokada, nie strona produktu. */
export function isCaptchaUrl(url: string): boolean {
  try {
    return /captcha|challenge|\/blocked|access-denied/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PriceFetchError('BLOCKED_URL', 'Nieprawidłowy adres')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PriceFetchError('BLOCKED_URL', 'Dozwolone są tylko adresy http(s)')
  if (url.username || url.password) throw new PriceFetchError('BLOCKED_URL', 'Adres nie może zawierać danych logowania')
  if (url.port && url.port !== '443' && url.port !== '80') throw new PriceFetchError('BLOCKED_URL', 'Niedozwolony port')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) throw new PriceFetchError('BLOCKED_URL', 'Adres prowadzi do sieci wewnętrznej')
  return url
}

/** Prosty magazyn cookies per host (w pamięci procesu): kolejne wizyty wyglądają jak ten sam gość. */
class CookieJar {
  private readonly jars = new Map<string, Map<string, string>>()

  header(host: string): string | undefined {
    const jar = this.jars.get(host)
    if (!jar || jar.size === 0) return undefined
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  store(host: string, response: Response): void {
    const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    if (cookies.length === 0) return
    const jar = this.jars.get(host) ?? new Map<string, string>()
    for (const cookie of cookies) {
      const [pair] = cookie.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name)
      else if (jar.size < 50) jar.set(name, value)
    }
    this.jars.set(host, jar)
    if (this.jars.size > 200) this.jars.delete(this.jars.keys().next().value as string)
  }
}

export function createHttpFetcher(fetchImpl: typeof fetch = createGuardedFetch(), userAgent = config.prices.userAgent): PageFetcher {
  const cookies = new CookieJar()

  return {
    kind: 'http',
    async fetch(rawUrl, { signal }) {
      const started = Date.now()
      let url = assertFetchableUrl(rawUrl)
      for (let redirects = 0; ; redirects++) {
        let response: Response
        try {
          response = await fetchImpl(url.toString(), {
            redirect: 'manual',
            signal,
            headers: {
              'User-Agent': userAgent,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.6,en;q=0.5',
              'Cache-Control': 'no-cache',
              'Upgrade-Insecure-Requests': '1',
              ...(cookies.header(url.host) ? { Cookie: cookies.header(url.host)! } : {}),
            },
          })
        } catch (err) {
          throw toFetchError(err, signal)
        }
        cookies.store(url.host, response)

        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {})
          const location = response.headers.get('location')
          if (!location) throw new PriceFetchError('HTTP_ERROR', `Przekierowanie bez adresu (${response.status})`, response.status)
          if (redirects >= MAX_REDIRECTS) throw new PriceFetchError('HTTP_ERROR', 'Zbyt wiele przekierowań', response.status)
          url = assertFetchableUrl(new URL(location, url).toString())
          continue
        }

        const contentType = response.headers.get('content-type') ?? ''
        const bytes = await readCapped(response, MAX_BYTES, signal)
        const html = decodeBody(bytes, contentType)
        if (looksBlocked(response.status, html) || isCaptchaUrl(url.toString())) {
          throw new PriceFetchError('BLOCKED', `Sklep zablokował zapytanie (HTTP ${response.status})`, response.status)
        }
        if (!response.ok) {
          throw new PriceFetchError('HTTP_ERROR', `Sklep zwrócił błąd ${response.status}`, response.status, response.status >= 500)
        }
        return { fetcher: 'http', status: response.status, finalUrl: url.toString(), html, durationMs: Date.now() - started }
      }
    },
  }
}

interface RenderResponse {
  status?: number
  finalUrl?: string
  html?: string
  error?: { code?: string; message?: string }
}

/** Klient serwisu przeglądarki (packages/browser). */
export function createBrowserFetcher(
  baseUrl: string | undefined = config.prices.browserUrl,
  token: string | undefined = config.prices.browserToken,
  fetchImpl: typeof fetch = fetch
): PageFetcher {
  return {
    kind: 'browser',
    async fetch(rawUrl, { signal, waitFor }) {
      const started = Date.now()
      assertFetchableUrl(rawUrl)
      if (!baseUrl) throw new PriceFetchError('BROWSER_UNAVAILABLE', 'Przeglądarka nie jest skonfigurowana (PRICE_BROWSER_URL)')
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/render`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ url: rawUrl, waitFor, timeoutMs: (config.prices.fetchTimeoutSeconds - 5) * 1000 }),
        })
      } catch (err) {
        if (signal.aborted) throw toFetchError(err, signal)
        throw new PriceFetchError('BROWSER_UNAVAILABLE', 'Serwis przeglądarki nie odpowiada')
      }
      const body = (await response.json().catch(() => ({}))) as RenderResponse
      if (!response.ok || body.error || typeof body.html !== 'string') {
        const code = (body.error?.code as PriceErrorCode | undefined) ?? 'BROWSER_UNAVAILABLE'
        throw new PriceFetchError(code, body.error?.message ?? `Serwis przeglądarki zwrócił ${response.status}`, body.status ?? null)
      }
      const status = body.status ?? 200
      if (looksBlocked(status, body.html) || isCaptchaUrl(body.finalUrl ?? rawUrl)) {
        throw new PriceFetchError('BLOCKED', `Sklep zablokował przeglądarkę (HTTP ${status})`, status)
      }
      if (status >= 400) throw new PriceFetchError('HTTP_ERROR', `Sklep zwrócił błąd ${status}`, status, status >= 500)
      return { fetcher: 'browser', status, finalUrl: body.finalUrl ?? rawUrl, html: body.html, durationMs: Date.now() - started }
    },
  }
}

async function readCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new PriceFetchError('TOO_LARGE', `Strona przekracza ${Math.round(maxBytes / 1024 / 1024)} MB`)
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof PriceFetchError) throw err
    throw toFetchError(err, signal)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function toFetchError(err: unknown, signal?: AbortSignal): PriceFetchError {
  if (err instanceof PriceFetchError) return err
  if (signal?.aborted) {
    const reason = signal.reason as { name?: string } | undefined
    return reason?.name === 'TimeoutError'
      ? new PriceFetchError('TIMEOUT', 'Strona nie odpowiedziała na czas', null, true)
      : new PriceFetchError('CANCELLED', 'Pobieranie zostało przerwane')
  }
  for (let cause = err as { code?: string; cause?: unknown } | undefined, depth = 0; cause && depth < 5; depth++) {
    if (cause.code === 'EBLOCKEDADDRESS') return new PriceFetchError('BLOCKED_URL', 'Adres prowadzi do sieci wewnętrznej')
    cause = cause.cause as typeof cause
  }
  return new PriceFetchError('NETWORK_ERROR', 'Brak połączenia ze sklepem', null, true)
}
