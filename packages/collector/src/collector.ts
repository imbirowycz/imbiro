import type { CollectorJob, CollectorResult, CollectorSettings } from '@myorg/shared'
import type { CollectorApi } from './api'
import type { PageLoader } from './browser'
import { assertPublicUrl, BlockedUrlError } from './ip-guard'

// The whole job of the collector: ask the server what to fetch, load the pages, send them back.
// No schedule, no database, no parsing — the server decides everything, including the limits.

/** Larger pages are reported as an error instead of being uploaded (the API accepts 8 MB). */
const MAX_HTML_BYTES = 6 * 1024 * 1024
/** Pause after a failed call to the API; doubles up to the maximum. */
const RETRY_MIN_MS = 10_000
const RETRY_MAX_MS = 5 * 60_000

export interface CollectorDeps {
  api: CollectorApi
  loader: PageLoader
  /** Throws BlockedUrlError for an address the collector must not open. */
  assertAllowed?: (url: string) => Promise<void>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

export class Collector {
  private readonly lastHit = new Map<string, number>()
  private readonly api: CollectorApi
  private readonly loader: PageLoader
  private readonly assertAllowed: (url: string) => Promise<void>
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly now: () => number
  private readonly log: (message: string) => void

  constructor(deps: CollectorDeps) {
    this.api = deps.api
    this.loader = deps.loader
    this.assertAllowed = deps.assertAllowed ?? assertPublicUrl
    this.sleep = deps.sleep ?? abortableSleep
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? ((message) => console.log(`${new Date().toISOString()} ${message}`))
  }

  /** Runs until `signal` aborts. A failing API or page never ends the loop. */
  async run(signal: AbortSignal): Promise<void> {
    let retryMs = RETRY_MIN_MS
    while (!signal.aborted) {
      let pauseMs: number
      try {
        const settings = await this.cycle(signal)
        pauseMs = settings.pollSeconds * 1000
        retryMs = RETRY_MIN_MS
      } catch (err) {
        if (signal.aborted) break
        this.log(`API niedostępne (${(err as Error).message}) — ponowię za ${Math.round(retryMs / 1000)} s`)
        pauseMs = retryMs
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      }
      await this.sleep(pauseMs, signal)
    }
  }

  /** One round: claim jobs, fetch each page, report each result. Returns the server's limits. */
  async cycle(signal: AbortSignal): Promise<CollectorSettings> {
    const { settings, jobs } = await this.api.claim()
    for (const job of jobs) {
      if (signal.aborted) break
      await this.waitForDomain(job.url, settings.domainGapSeconds * 1000, signal)
      const result = await this.fetch(job, settings.pageTimeoutSeconds * 1000)
      this.log(`${hostOf(job.url)} → ${result.ok ? `HTTP ${result.httpStatus}, ${result.html?.length ?? 0} znaków` : result.error?.code}`)
      await this.api.report(result)
    }
    return settings
  }

  private async fetch(job: CollectorJob, timeoutMs: number): Promise<CollectorResult> {
    const started = this.now()
    const failure = (code: NonNullable<CollectorResult['error']>['code'], message: string): CollectorResult => ({
      jobId: job.jobId,
      ok: false,
      httpStatus: null,
      finalUrl: null,
      html: null,
      durationMs: this.now() - started,
      error: { code, message },
    })
    try {
      await this.assertAllowed(job.url)
      const page = await this.loader.load(job.url, { waitFor: job.waitFor, timeoutMs })
      // A redirect must not lead into the home network either.
      await this.assertAllowed(page.finalUrl)
      if (Buffer.byteLength(page.html) > MAX_HTML_BYTES) return failure('TOO_LARGE', 'Strona jest za duża')
      return { jobId: job.jobId, ok: true, httpStatus: page.httpStatus, finalUrl: page.finalUrl, html: page.html, durationMs: this.now() - started }
    } catch (err) {
      if (err instanceof BlockedUrlError) return failure('BLOCKED_URL', err.message)
      const message = (err as Error).message.split('\n')[0].slice(0, 300)
      return /timeout/i.test(message) ? failure('TIMEOUT', 'Strona nie załadowała się na czas') : failure('NETWORK_ERROR', message)
    }
  }

  /** At most one page load per domain every `gapMs`. */
  private async waitForDomain(url: string, gapMs: number, signal: AbortSignal): Promise<void> {
    const host = hostOf(url)
    const wait = (this.lastHit.get(host) ?? -Infinity) + gapMs - this.now()
    if (wait > 0) await this.sleep(wait, signal)
    this.lastHit.set(host, this.now())
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Resolves after `ms` or as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
