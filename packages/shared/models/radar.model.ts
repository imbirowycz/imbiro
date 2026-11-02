// Personal Radar: contracts shared by the backend (modules, runner, API) and the frontend.

export type RadarGroupId = 'news' | 'finance' | 'alerts' | 'weather' | 'overview'

/** Tells consumers (dashboard, delivery formatters) how to render `data` items. */
export type RadarItemKind = 'currency-rate' | 'gold-price' | 'news'

export type ModuleStatus = 'success' | 'partial' | 'error'

/** Error codes safe to show to the user; never contain raw upstream details. */
export type RadarErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'TOO_LARGE'
  | 'BLOCKED_URL'
  | 'INVALID_RESPONSE'
  | 'PARSE_ERROR'
  | 'INTERNAL'

export interface RadarError {
  code: RadarErrorCode
  message: string
}

export interface RadarSourceInfo {
  name: string
  homepage: string
  /** Required attribution text, if the source demands one (e.g. IMGW-PIB). */
  attribution?: string
}

/** Uniform result of a single module run. Dates are ISO 8601. */
export interface ModuleResult<T = unknown> {
  moduleId: string
  group: RadarGroupId
  itemKind: RadarItemKind | null
  source: RadarSourceInfo
  status: ModuleStatus
  /** When the data was fetched from the source (not when it was served from cache). */
  fetchedAt: string
  durationMs: number
  /** True when served from the in-memory cache. */
  cached: boolean
  /** Real date of the data according to the source (e.g. NBP quotation date), if it differs from fetchedAt. */
  dataAsOf: string | null
  data: T[]
  warnings: string[]
  error: RadarError | null
}

export type RunTarget =
  | { kind: 'module'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'modules'; ids: string[] }

/** Aggregated result of running several modules. */
export interface RunResult {
  target: RunTarget
  /** success = all modules succeeded, error = none did, partial = anything in between. */
  status: ModuleStatus
  startedAt: string
  durationMs: number
  results: ModuleResult[]
}

export interface RadarModuleInfo {
  id: string
  name: string
  group: RadarGroupId
  category: string | null
  description: string
  source: RadarSourceInfo
  itemKind: RadarItemKind | null
  /** composite = aggregates other modules. */
  kind: 'collector' | 'composite'
}

export interface RadarGroupInfo {
  id: string
  name: string
  description: string
  moduleIds: string[]
}

// ---- Item models ----

export interface CurrencyRate {
  /** ISO 4217, e.g. "EUR". */
  code: string
  name: string
  /** Average NBP rate in PLN. */
  mid: number
  /** Difference to the previous table; null when unavailable. */
  change: number | null
  /** Quotation date (YYYY-MM-DD) — may be an earlier business day. */
  effectiveDate: string
  tableNo: string
}

export interface GoldPrice {
  /** Quotation date (YYYY-MM-DD). */
  date: string
  /** PLN per 1 g of gold (purity 1000). */
  pricePerGram: number
  change: number | null
}

export type NewsCategory = 'poland' | 'world' | 'warsaw' | 'economy' | 'it' | 'ai' | 'security'

/**
 * One news entry, normalized from RSS/Atom/API. Images are intentionally not included
 * (decision: no external images — CSP and privacy).
 */
export interface NewsItem {
  /** Source-specific id (GUID, Atom id, HN id) — stable between fetches. */
  id: string
  title: string
  /** Plain text (HTML stripped), shortened; null when the source has none or repeats the title. */
  summary: string | null
  /** Canonical http(s) URL of the article. */
  url: string
  source: string
  category: NewsCategory
  publishedAt: string | null
  author: string | null
  /** Rule-based relevance (no AI): higher = closer to configured interests and fresher. */
  relevance: {
    score: number
    /** Labels of matched interests, e.g. ["Vue", "Warszawa"]. */
    matches: string[]
  }
}
