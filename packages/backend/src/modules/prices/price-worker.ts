import type { JobWithMetadata } from 'pg-boss'
import type { PriceErrorCode, PriceSourceStatus } from '@myorg/shared'
import { config } from '../../config'
import { checkSource, type CheckOutcome } from './price-check'
import { enqueuePriceCheck, type PriceCheckJobData } from './price-queue'
import { type ItemRecord, PricesRepository, type SourceRecord } from './prices.repository'

// Obsługa jobów `prices.check`: jedno źródło na job. Błąd jednego źródła zapisuje się w jego
// historii i stanie — nie wpływa na inne źródła ani artykuły.

const RETRYABLE: ReadonlySet<PriceErrorCode> = new Set(['NETWORK_ERROR', 'TIMEOUT', 'BROWSER_UNAVAILABLE'])
const FAILING_AFTER = 3
const SNAPSHOT_MAX = 500_000

export interface CheckHooks {
  /** Po udanym pomiarze (krok 7: ocena i okazje). */
  onSuccess?: (item: ItemRecord, source: SourceRecord, outcome: CheckOutcome, job: PriceCheckJobData) => Promise<unknown>
  /** Źródło przeszło w stan failing/blocked (krok 8: powiadomienie). */
  onFailing?: (item: ItemRecord, source: SourceRecord, status: PriceSourceStatus, error: string) => Promise<unknown>
}

export type CheckResult =
  | { skipped: string }
  | { ok: true; price: number; fetcher: string; extra?: unknown }
  | { ok: false; status: PriceSourceStatus; error: string }
  | { suspicious: true; price: number; previous: number }

export class PriceCheckWorker {
  private readonly lastHit = new Map<string, number>()

  constructor(
    private readonly hooks: CheckHooks = {},
    private readonly repo = new PricesRepository(),
    private readonly check = checkSource,
    private readonly gapMs = config.prices.domainGapSeconds * 1000
  ) {}

  async process(job: JobWithMetadata<PriceCheckJobData>): Promise<CheckResult> {
    const data = job.data
    const source = await this.repo.findSource(data.sourceId)
    if (!source) return { skipped: 'source no longer exists' }
    const item = await this.repo.findItem(source.itemId)
    if (!item) return { skipped: 'item no longer exists' }
    if (!item.enabled && data.reason === 'schedule') return { skipped: 'item disabled' }

    await this.throttle(source.url, job.signal)
    const outcome = await this.check({
      url: source.url,
      mode: source.fetchMode,
      preferred: source.preferredFetcher,
      definition: source.definition,
      signal: job.signal,
    })
    const tag = `[prices ${source.label} ${source.id.slice(0, 8)}]`

    if (outcome.ok && outcome.extraction && outcome.extraction.price !== null && outcome.fetcher) {
      const { extraction } = outcome
      const price = extraction.price as number
      // Podejrzana zmiana (> 70%): zanim cokolwiek zapiszemy, sprawdzamy jeszcze raz za 15 min.
      const previous = source.lastPrice
      if (data.reason !== 'confirm' && previous !== null && previous > 0 && Math.abs(price - previous) / previous > 0.7) {
        await enqueuePriceCheck({ sourceId: source.id, reason: 'confirm', suspectPrice: price }, { startAfter: new Date(Date.now() + 15 * 60_000) })
        console.warn(`${tag} suspicious price ${price} (was ${previous}), confirming in 15 min`)
        return { suspicious: true, price, previous }
      }
      await this.repo.insertObservation(source.id, {
        ok: true,
        price,
        oldPrice: extraction.oldPrice,
        currency: extraction.currency,
        available: extraction.available,
        title: extraction.title,
        fetcher: outcome.fetcher,
        durationMs: outcome.durationMs,
        errorCode: null,
        error: null,
      })
      await this.repo.recordSuccess(source.id, {
        price,
        oldPrice: extraction.oldPrice,
        available: extraction.available,
        title: extraction.title,
        currency: extraction.currency,
        fetcher: outcome.fetcher,
      })
      const extra = this.hooks.onSuccess ? await this.hooks.onSuccess(item, source, outcome, data) : undefined
      console.log(`${tag} ${price} ${extraction.currency} via ${outcome.fetcher}`)
      return { ok: true, price, fetcher: outcome.fetcher, extra }
    }

    const code = outcome.error?.code ?? 'PRICE_NOT_FOUND'
    const message = outcome.error?.message ?? 'Nie znaleziono ceny'
    // Błędy przejściowe: ponów (pg-boss, z rosnącym odstępem) zanim uznamy sprawdzenie za nieudane.
    if (RETRYABLE.has(code) && job.retryCount < job.retryLimit) {
      console.warn(`${tag} ${code}: ${message} — retry ${job.retryCount + 1}/${job.retryLimit}`)
      throw new Error(`${code}: ${message}`)
    }

    await this.repo.insertObservation(source.id, {
      ok: false,
      price: null,
      oldPrice: null,
      currency: null,
      available: null,
      title: null,
      fetcher: outcome.fetcher,
      durationMs: outcome.durationMs,
      errorCode: code,
      error: message,
    })
    const failures = source.consecutiveFailures + 1
    const status: PriceSourceStatus = failures >= FAILING_AFTER ? (code === 'BLOCKED' ? 'blocked' : 'failing') : 'warning'
    await this.repo.recordFailure(source.id, { status, error: message, errorCode: code })
    if (outcome.page) {
      await this.repo.insertSnapshot(source.id, {
        fetcher: outcome.page.fetcher,
        httpStatus: outcome.page.status,
        errorCode: code,
        html: outcome.page.html.slice(0, SNAPSHOT_MAX),
      })
    }
    if ((status === 'failing' || status === 'blocked') && !source.failingAlerted) {
      await this.repo.setFailingAlerted(source.id)
      await this.hooks.onFailing?.(item, source, status, message).catch((err) => console.error(`${tag} failing alert failed`, err))
    }
    console.warn(`${tag} ${status} (${failures}x): ${code} ${message}`)
    return { ok: false, status, error: message }
  }

  /** Najwyżej jedno zapytanie do domeny co `gapMs` (worker sprawdza źródła pojedynczo). */
  private async throttle(url: string, signal: AbortSignal): Promise<void> {
    let host: string
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return
    }
    const wait = (this.lastHit.get(host) ?? 0) + this.gapMs - Date.now()
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait)
        signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
      })
    }
    this.lastHit.set(host, Date.now())
  }
}
