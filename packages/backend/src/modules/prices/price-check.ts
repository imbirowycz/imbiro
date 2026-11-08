import type {
  PriceExtraction,
  PriceFetchAttempt,
  PriceFetcher,
  PriceFetchMode,
  PriceSourceDefinition,
  PriceSourceTestResult,
} from '@myorg/shared'
import { config } from '../../config'
import { compareWithExpected, DefinitionError, extractProduct } from './price-extract'
import { createBrowserFetcher, createHttpFetcher, type FetchedPage, type PageFetcher, PriceFetchError, toFetchError } from './price-fetch'

// Jedno sprawdzenie źródła: pobranie strony właściwym sposobem i wyciągnięcie danych.
// W trybie auto: najpierw preferowany sposób, a przy blokadzie/błędzie/braku ceny — drugi.

export interface CheckOutcome extends PriceSourceTestResult {
  page: FetchedPage | null
}

export interface Fetchers {
  http: PageFetcher
  browser: PageFetcher
}

let defaultFetchers: Fetchers | null = null
export function getFetchers(): Fetchers {
  defaultFetchers ??= { http: createHttpFetcher(), browser: createBrowserFetcher() }
  return defaultFetchers
}

export function fetcherOrder(mode: PriceFetchMode, preferred: PriceFetcher = 'http'): PriceFetcher[] {
  if (mode === 'http') return ['http']
  if (mode === 'browser') return ['browser']
  return preferred === 'browser' ? ['browser', 'http'] : ['http', 'browser']
}

export interface CheckParams {
  url: string
  mode: PriceFetchMode
  preferred?: PriceFetcher
  definition: PriceSourceDefinition
  signal?: AbortSignal
  fetchers?: Fetchers
}

export async function checkSource(params: CheckParams): Promise<CheckOutcome> {
  const fetchers = params.fetchers ?? getFetchers()
  const started = Date.now()
  const attempts: PriceFetchAttempt[] = []
  const order = fetcherOrder(params.mode, params.preferred)
  let last: CheckOutcome | null = null

  for (const [index, kind] of order.entries()) {
    const isLast = index === order.length - 1
    // Przeglądarka nieskonfigurowana w trybie auto: po prostu pomijamy ją po cichu.
    const attemptStarted = Date.now()
    const signal = attemptSignal(params.signal)
    let page: FetchedPage
    try {
      page = await fetchers[kind].fetch(params.url, { signal, waitFor: params.definition.fetch?.waitFor })
    } catch (err) {
      const error = toFetchError(err, signal)
      if (params.signal?.aborted) throw error
      const skippedBrowser = error.code === 'BROWSER_UNAVAILABLE' && params.mode === 'auto' && attempts.length > 0
      if (!skippedBrowser) {
        attempts.push({ fetcher: kind, ok: false, httpStatus: error.status, durationMs: Date.now() - attemptStarted, error: { code: error.code, message: error.message } })
      }
      if (!isLast) continue
      return last ?? failure(attempts, started, error)
    }

    let extraction: PriceExtraction
    let selectorMatches: CheckOutcome['selectorMatches']
    try {
      ;({ extraction, selectorMatches } = extractProduct(page.html, params.definition, page.finalUrl))
    } catch (err) {
      if (err instanceof DefinitionError) {
        attempts.push({ fetcher: kind, ok: false, httpStatus: page.status, durationMs: page.durationMs, error: { code: 'INVALID_DEFINITION', message: err.message } })
        return failure(attempts, started, new PriceFetchError('INVALID_DEFINITION', err.message, page.status))
      }
      throw err
    }

    const ok = extraction.price !== null
    attempts.push({
      fetcher: kind,
      ok,
      httpStatus: page.status,
      durationMs: page.durationMs,
      error: ok ? null : { code: 'PRICE_NOT_FOUND', message: 'Nie znaleziono ceny na stronie' },
    })
    const outcome: CheckOutcome = {
      ok,
      fetcher: kind,
      httpStatus: page.status,
      finalUrl: page.finalUrl,
      durationMs: Date.now() - started,
      extraction,
      comparison: compareWithExpected(extraction, params.definition.expected),
      selectorMatches,
      attempts,
      error: ok ? null : { code: 'PRICE_NOT_FOUND', message: 'Nie znaleziono ceny na stronie' },
      page,
    }
    if (ok || isLast) {
      // Brak ceny także w drugiej próbie: zostaw wynik z pierwszej strony, jeśli ta nie była lepsza.
      return ok ? outcome : (last ?? outcome)
    }
    last = outcome
  }
  return last ?? failure(attempts, started, new PriceFetchError('PRICE_NOT_FOUND', 'Nie znaleziono ceny'))
}

function attemptSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(config.prices.fetchTimeoutSeconds * 1000)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function failure(attempts: PriceFetchAttempt[], started: number, error: PriceFetchError): CheckOutcome {
  return {
    ok: false,
    fetcher: null,
    httpStatus: error.status,
    finalUrl: null,
    durationMs: Date.now() - started,
    extraction: null,
    comparison: [],
    selectorMatches: [],
    attempts,
    error: { code: error.code, message: error.message },
    page: null,
  }
}

/** Pobiera samą stronę (do snapshotu dla AI): w trybie auto http, a przy blokadzie przeglądarka. */
export async function fetchPage(url: string, mode: PriceFetchMode, signal?: AbortSignal, fetchers = getFetchers()): Promise<FetchedPage> {
  let lastError: PriceFetchError | null = null
  for (const kind of fetcherOrder(mode)) {
    try {
      return await fetchers[kind].fetch(url, { signal: attemptSignal(signal) })
    } catch (err) {
      lastError = toFetchError(err, signal)
      if (signal?.aborted) throw lastError
      if (lastError.code === 'BROWSER_UNAVAILABLE' && mode === 'auto' && kind === 'browser') break
    }
  }
  throw lastError ?? new PriceFetchError('NETWORK_ERROR', 'Nie udało się pobrać strony')
}

/** Odpowiedź API bez pobranego HTML. */
export function toTestResult(outcome: CheckOutcome): PriceSourceTestResult {
  const { page: _page, ...rest } = outcome
  return rest
}
