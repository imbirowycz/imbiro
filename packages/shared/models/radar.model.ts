// Personal Radar: contracts shared by the backend (modules, runner, API) and the frontend.

export type RadarGroupId = 'news' | 'finance' | 'alerts' | 'weather' | 'overview'

/** Tells consumers (dashboard, delivery formatters) how to render `data` items. */
export type RadarItemKind =
  | 'currency-rate'
  | 'gold-price'
  | 'news'
  | 'weather-now'
  | 'weather-day'
  | 'alert'
  | 'air-quality'
  | 'overview-block'

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
  /**
   * True when the source failed just now and these are the last good data (stale-if-error).
   * `fetchedAt` then tells how old they are; `warnings` explains why.
   */
  stale: boolean
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

export type NewsCategory = 'poland' | 'world' | 'warsaw' | 'economy' | 'it' | 'ai' | 'security' | 'health'
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

// ---- Weather ----

export interface WeatherHour {
  time: string
  temperature: number
  precipitationProbability: number | null
  precipitation: number
  weatherCode: number
  description: string
  windSpeed: number
}

/** Current conditions plus the next hours. Units: °C, mm, km/h, %. */
export interface WeatherNow {
  location: string
  observedAt: string
  temperature: number
  apparentTemperature: number
  humidity: number
  precipitation: number
  windSpeed: number
  /** Null when the source does not provide gusts (e.g. MET Norway). */
  windGusts: number | null
  weatherCode: number
  description: string
  isDay: boolean
  hours: WeatherHour[]
}

export interface WeatherDay {
  /** YYYY-MM-DD in the location's time zone. */
  date: string
  weatherCode: number
  description: string
  temperatureMin: number
  temperatureMax: number
  precipitationSum: number
  precipitationProbabilityMax: number | null
  windSpeedMax: number
  sunrise: string | null
  sunset: string | null
}

// ---- Alerts ----

/** info = informational, low/medium/high ≈ IMGW yellow/orange/red. */
export type AlertSeverity = 'info' | 'low' | 'medium' | 'high'
export type AlertCategory = 'weather' | 'hydro' | 'air' | 'transport'

export interface AlertItem {
  id: string
  source: string
  category: AlertCategory
  title: string
  description: string | null
  severity: AlertSeverity
  location: string
  issuedAt: string | null
  validFrom: string | null
  expiresAt: string | null
  url: string | null
}

export type AirPollutantCode = 'PM10' | 'PM2.5' | 'NO2' | 'SO2' | 'O3'

export interface AirPollutant {
  code: AirPollutantCode
  /** GIOŚ index category for this pollutant, e.g. "Dobry". */
  indexCategory: string | null
  /** Latest hourly concentration (µg/m³), when measured at this station. */
  value: number | null
  measuredAt: string | null
}

/** Air quality at one measuring station (GIOŚ). */
export interface AirQualityStation {
  stationId: number
  name: string
  /** GIOŚ index 0 (very good) … 5 (very bad); null when not computed. */
  indexValue: number | null
  indexCategory: string | null
  criticalPollutant: string | null
  measuredAt: string | null
  severity: AlertSeverity
  pollutants: AirPollutant[]
}

// ---- Overview (composite) ----

/** One block of an aggregated overview, e.g. "Pogoda" or "Polska — najważniejsze". */
export interface OverviewBlock {
  key: string
  title: string
  /** How to render `items` (same renderers as regular modules). */
  itemKind: Exclude<RadarItemKind, 'overview-block'>
  status: ModuleStatus
  items: unknown[]
  sources: string[]
  /** Attribution texts required by the underlying sources (e.g. IMGW-PIB). */
  attributions: string[]
  dataAsOf: string | null
  /** User-facing message when all modules behind the block failed. */
  error: string | null
}

// ---- Dashboard ----

/** Page of the app that shows the section: Home (news, alerts) or Weather & finance. */
export type DashboardPage = 'home' | 'weather'

export interface DashboardSection {
  /** Stable id, also used as the anchor on its page. */
  id: string
  page: DashboardPage
  title: string
  moduleIds: string[]
}

/** GET /api/radar/dashboard — layout plus cached results (null = not fetched yet). */
export interface DashboardLayout {
  generatedAt: string
  /** Domains the Article Reader accepts (an article URL on the domain or a subdomain). */
  readerDomains: string[]
  /** Keys of news/alerts marked as read (`newsReadKey`, `alertReadKey`) — the dashboard hides them. */
  readKeys: string[]
  sections: (DashboardSection & { results: (ModuleResult | null)[] })[]
}

// ---- Article Reader ----

/**
 * success     — article extracted and sanitized
 * unavailable — fetched, but no readable content (paywall, unusual page, error); open the original
 * unsupported — domain is not on the reader allowlist
 */
export type ArticleStatus = 'success' | 'unavailable' | 'unsupported'

/** GET /api/radar/articles/read?url= — nothing of it is stored in the database. */
export interface ArticleView {
  status: ArticleStatus
  /** The URL that was requested (canonical form). Always present, so the user can open the original. */
  url: string
  title: string | null
  author: string | null
  /** Site name, e.g. "RMF24", or the host name. */
  source: string
  publishedAt: string | null
  excerpt: string | null
  /** Sanitized HTML: text structure and links only (no scripts, styles, images, embeds). */
  html: string | null
  text: string | null
  wordCount: number
  readingMinutes: number
  fetchedAt: string
  /** User-facing explanation for unavailable/unsupported. */
  message: string | null
}
