import type { z } from 'zod'
import { RadarSourceError } from '../core/radar.errors'

// The only way radar modules talk to the outside world. Every request is:
// https-only, limited to an allowlist of hosts (also after redirects), size-capped,
// abortable, and retried with exponential backoff only when retrying makes sense.

export const RADAR_USER_AGENT = 'imbiro-radar/1.0 (personal news aggregator)'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_RETRIES = 2
const MAX_REDIRECTS = 3
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 5_000

export interface RequestOptions {
  signal: AbortSignal
  /** Response body limit; larger bodies fail with TOO_LARGE. */
  maxBytes?: number
  /** Extra attempts for retryable failures (network, 5xx, 429). */
  retries?: number
  accept?: string
}

export interface TextResponse {
  text: string
  contentType: string
  /** Final URL after redirects. */
  url: string
}

export interface HttpClient {
  getText(url: string, options: RequestOptions): Promise<TextResponse>
  /** Fetches JSON and validates it; a schema mismatch is INVALID_RESPONSE. */
  getJson<T>(url: string, schema: z.ZodType<T>, options: RequestOptions): Promise<T>
}

export interface HttpClientOptions {
  allowedHosts: readonly string[]
  /** Alternative rule (e.g. "domain and its subdomains"); when set, it replaces `allowedHosts`. */
  isAllowedHost?: (hostname: string) => boolean
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export function createHttpClient({ allowedHosts, isAllowedHost, fetchImpl = fetch, sleep = abortableSleep }: HttpClientOptions): HttpClient {
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()))
  const allowed = isAllowedHost ?? ((hostname: string) => hosts.has(hostname))

  async function getText(url: string, options: RequestOptions): Promise<TextResponse> {
    const retries = options.retries ?? DEFAULT_RETRIES
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnce(url, options)
      } catch (err) {
        const error = toSourceError(err, options.signal)
        if (!error.retryable || attempt >= retries || options.signal.aborted) throw error
        const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) * (0.75 + Math.random() * 0.5)
        await sleep(Math.min(MAX_BACKOFF_MS, error.retryAfterMs ?? backoff), options.signal)
      }
    }
  }

  async function fetchOnce(initialUrl: string, options: RequestOptions): Promise<TextResponse> {
    let url = assertAllowed(initialUrl, allowed)

    for (let redirects = 0; ; redirects++) {
      const response = await fetchImpl(url, {
        // Manual redirects: every hop must pass the allowlist again.
        redirect: 'manual',
        signal: options.signal,
        headers: { 'User-Agent': RADAR_USER_AGENT, Accept: options.accept ?? '*/*' },
      })

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {})
        const location = response.headers.get('location')
        if (!location) throw new RadarSourceError('HTTP_ERROR', `Źródło zwróciło przekierowanie bez adresu (${response.status})`)
        if (redirects >= MAX_REDIRECTS) throw new RadarSourceError('HTTP_ERROR', 'Zbyt wiele przekierowań')
        url = assertAllowed(new URL(location, url).toString(), allowed)
        continue
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw httpError(response)
      }

      const contentType = response.headers.get('content-type') ?? ''
      const bytes = await readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
      return { text: decodeBody(bytes, contentType), contentType, url }
    }
  }

  async function getJson<T>(url: string, schema: z.ZodType<T>, options: RequestOptions): Promise<T> {
    const { text } = await getText(url, { accept: 'application/json', ...options })
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new RadarSourceError('PARSE_ERROR', 'Odpowiedź źródła nie jest poprawnym JSON-em')
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new RadarSourceError(
        'INVALID_RESPONSE',
        `Nieoczekiwany format danych źródła (${issue.path.join('.') || 'root'}: ${issue.message})`
      )
    }
    return parsed.data
  }

  return { getText, getJson }
}

/** Returns the normalized URL or throws BLOCKED_URL. */
export function assertAllowed(rawUrl: string, isAllowed: (hostname: string) => boolean): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RadarSourceError('BLOCKED_URL', 'Nieprawidłowy adres')
  }
  if (url.protocol !== 'https:') throw new RadarSourceError('BLOCKED_URL', 'Dozwolone są tylko adresy https')
  if (url.username || url.password) throw new RadarSourceError('BLOCKED_URL', 'Adres nie może zawierać danych logowania')
  if (url.port && url.port !== '443') throw new RadarSourceError('BLOCKED_URL', 'Niedozwolony port')
  if (!isAllowed(url.hostname.toLowerCase())) {
    throw new RadarSourceError('BLOCKED_URL', `Host ${url.hostname} nie jest na liście dozwolonych`)
  }
  return url.toString()
}

function httpError(response: Response): RadarSourceError {
  if (response.status === 429) {
    return new RadarSourceError('RATE_LIMITED', 'Źródło chwilowo ogranicza liczbę zapytań (429)', true, retryAfterMs(response))
  }
  if (response.status >= 500) {
    return new RadarSourceError('HTTP_ERROR', `Źródło zwróciło błąd ${response.status}`, true)
  }
  return new RadarSourceError('HTTP_ERROR', `Źródło zwróciło błąd ${response.status}`)
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** Reads the body as a stream and stops as soon as it exceeds `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new RadarSourceError('TOO_LARGE', `Odpowiedź źródła przekracza ${Math.round(maxBytes / 1024)} KB`)
  }
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new RadarSourceError('TOO_LARGE', `Odpowiedź źródła przekracza ${Math.round(maxBytes / 1024)} KB`)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** Decodes using the charset from Content-Type, then from an XML prolog, else UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const fromProlog = /^\s*<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1]
  for (const label of [fromHeader, fromProlog, 'utf-8']) {
    if (!label) continue
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      // Unknown label — try the next candidate.
    }
  }
  return new TextDecoder().decode(bytes)
}

/** Maps any thrown value to RadarSourceError, recognizing aborts (timeout vs cancel). */
export function toSourceError(err: unknown, signal: AbortSignal): RadarSourceError {
  if (err instanceof RadarSourceError) return err
  if (signal.aborted) return abortError(signal)
  // SSRF guard (reader): the connection was refused because the host resolves to an internal address.
  for (let cause = err as { code?: string; cause?: unknown } | undefined, depth = 0; cause && depth < 5; depth++) {
    if (cause.code === 'EBLOCKEDADDRESS') return new RadarSourceError('BLOCKED_URL', 'Adres prowadzi do sieci wewnętrznej')
    cause = cause.cause as typeof cause
  }
  // fetch() network failures (DNS, connection reset, TLS) surface as TypeError.
  return new RadarSourceError('NETWORK_ERROR', 'Brak połączenia ze źródłem', true)
}

export function abortError(signal: AbortSignal): RadarSourceError {
  const reason = signal.reason as { name?: string } | undefined
  if (reason instanceof RadarSourceError) return reason
  return reason?.name === 'TimeoutError'
    ? new RadarSourceError('TIMEOUT', 'Źródło nie odpowiedziało na czas')
    : new RadarSourceError('CANCELLED', 'Pobieranie zostało przerwane')
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
