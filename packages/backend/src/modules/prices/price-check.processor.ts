import type { CollectorResult, PriceErrorCode, PriceExtraction, PriceSourceStatus } from '@myorg/shared'
import { applyOffers, type OfferChange } from './price-evaluate'
import { DefinitionError, extractProduct } from './price-extract'
import { isCaptchaUrl, looksBlocked } from './price-html'
import type { PriceCheckJob, PriceQueue } from './price-queue'
import type { ItemRecord, PricesRepository, SourceRecord } from './prices.repository'

// Turns a page delivered by the home collector into a measurement: extracts the price, records
// the result in the source's history and state, detects deals and notifies. One source per job —
// a failing source affects neither the other sources nor other items.

/** Collector failures worth another attempt before the check counts as failed. */
const RETRYABLE: ReadonlySet<PriceErrorCode> = new Set(['NETWORK_ERROR', 'TIMEOUT'])
const FAILING_AFTER = 3
const SNAPSHOT_MAX = 500_000
/** A price change this large is confirmed by a second check before anything is saved. */
const SUSPICIOUS_CHANGE = 0.7
const CONFIRM_AFTER_MS = 15 * 60_000

export interface CheckNotifier {
  notifyOffers(item: ItemRecord, source: SourceRecord, changes: OfferChange[]): Promise<void>
  notifyFailing(item: ItemRecord, source: SourceRecord, status: PriceSourceStatus, error: string): Promise<void>
}

export type CheckOutcome =
  | { skipped: string }
  | { ok: true; price: number; offers: string[] }
  | { ok: false; status: PriceSourceStatus; error: string }
  | { suspicious: true; price: number; previous: number }
  | { retry: string }

type PageVerdict =
  | { extraction: PriceExtraction & { price: number } }
  | { code: PriceErrorCode; message: string }

/** What a delivered page means: a price, or the reason there is none. Pure. */
export function judgePage(result: CollectorResult, source: Pick<SourceRecord, 'url' | 'definition'>): PageVerdict {
  if (!result.ok || result.html === null) {
    return result.error ?? { code: 'NETWORK_ERROR', message: 'Zbieracz nie pobrał strony' }
  }
  const status = result.httpStatus ?? 0
  if (isCaptchaUrl(result.finalUrl)) return { code: 'BLOCKED', message: 'Sklep przekierował na stronę weryfikacji (captcha)' }
  if (status >= 400) {
    return looksBlocked(status, result.html)
      ? { code: 'BLOCKED', message: `Sklep zablokował pobranie strony (HTTP ${status})` }
      : { code: 'HTTP_ERROR', message: `Sklep zwrócił błąd ${status}` }
  }
  let extraction: PriceExtraction
  try {
    ;({ extraction } = extractProduct(result.html, source.definition, result.finalUrl ?? source.url))
  } catch (err) {
    if (err instanceof DefinitionError) return { code: 'INVALID_DEFINITION', message: err.message }
    throw err
  }
  if (extraction.price !== null) return { extraction: { ...extraction, price: extraction.price } }
  return looksBlocked(status, result.html)
    ? { code: 'BLOCKED', message: 'Sklep pokazał stronę weryfikacji zamiast produktu' }
    : { code: 'PRICE_NOT_FOUND', message: 'Nie znaleziono ceny na stronie' }
}

export class PriceCheckProcessor {
  constructor(
    private readonly repo: PricesRepository,
    private readonly queue: PriceQueue,
    private readonly notifier: CheckNotifier,
    /** Detects and saves deals; returns the ones to notify about. */
    private readonly evaluate: typeof applyOffers = applyOffers
  ) {}

  async process(job: PriceCheckJob, result: CollectorResult): Promise<CheckOutcome> {
    const source = await this.repo.findSource(job.data.sourceId)
    if (!source) return this.done(job, { skipped: 'source no longer exists' })
    const item = await this.repo.findItem(source.itemId)
    if (!item) return this.done(job, { skipped: 'item no longer exists' })

    const verdict = judgePage(result, source)
    const tag = `[prices ${source.label} ${source.id.slice(0, 8)}]`

    if ('extraction' in verdict) {
      const { extraction } = verdict
      const previous = source.lastPrice
      if (job.data.reason !== 'confirm' && previous !== null && previous > 0 && Math.abs(extraction.price - previous) / previous > SUSPICIOUS_CHANGE) {
        await this.queue.enqueue({ sourceId: source.id, reason: 'confirm' }, { startAfter: new Date(Date.now() + CONFIRM_AFTER_MS) })
        console.warn(`${tag} suspicious price ${extraction.price} (was ${previous}), confirming in 15 min`)
        return this.done(job, { suspicious: true, price: extraction.price, previous })
      }
      await this.repo.insertObservation(source.id, {
        ok: true,
        price: extraction.price,
        oldPrice: extraction.oldPrice,
        currency: extraction.currency,
        available: extraction.available,
        title: extraction.title,
        durationMs: result.durationMs,
        errorCode: null,
        error: null,
      })
      await this.repo.recordSuccess(source.id, extraction)
      // Deals are judged against the state from before this measurement (`source`).
      const changes = await this.evaluate(this.repo, item, source, { ...extraction, url: source.url })
      if (changes.length) await this.notifier.notifyOffers(item, source, changes)
      console.log(`${tag} ${extraction.price} ${extraction.currency}`)
      return this.done(job, { ok: true, price: extraction.price, offers: changes.map((c) => `${c.offer.kind}:${c.change}`) })
    }

    const { code, message } = verdict
    if (RETRYABLE.has(code) && job.retryCount < job.retryLimit) {
      console.warn(`${tag} ${code}: ${message} — retry ${job.retryCount + 1}/${job.retryLimit}`)
      await this.queue.fail(job.id, { code, message })
      return { retry: code }
    }

    await this.repo.insertObservation(source.id, {
      ok: false,
      price: null,
      oldPrice: null,
      currency: null,
      available: null,
      title: null,
      durationMs: result.durationMs,
      errorCode: code,
      error: message,
    })
    const failures = source.consecutiveFailures + 1
    const status: PriceSourceStatus = failures >= FAILING_AFTER ? (code === 'BLOCKED' ? 'blocked' : 'failing') : 'warning'
    await this.repo.recordFailure(source.id, { status, error: message, errorCode: code })
    if (result.html) {
      await this.repo.insertSnapshot(source.id, { httpStatus: result.httpStatus, errorCode: code, html: result.html.slice(0, SNAPSHOT_MAX) })
    }
    if ((status === 'failing' || status === 'blocked') && !source.failingAlerted) {
      await this.repo.setFailingAlerted(source.id)
      await this.notifier.notifyFailing(item, source, status, message).catch((err) => console.error(`${tag} failing alert failed`, err))
    }
    console.warn(`${tag} ${status} (${failures}x): ${code} ${message}`)
    return this.done(job, { ok: false, status, error: message })
  }

  private async done<T extends CheckOutcome>(job: PriceCheckJob, outcome: T): Promise<T> {
    await this.queue.complete(job.id, outcome)
    return outcome
  }
}
