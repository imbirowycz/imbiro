// Okazje (price tracking): types shared by the API, the PWA and the home collector.
// Input validation (zod) lives in the backend: packages/backend/src/modules/prices/prices.schemas.ts

export type PriceSourceStatus = 'untested' | 'ok' | 'warning' | 'failing' | 'blocked'
export type PriceOfferKind = 'price_drop' | 'promo' | 'target_reached' | 'back_in_stock' | 'lowest_30d'
export type PriceValueParse = 'pl-price' | 'number' | 'text'
export type PriceStrategy = 'auto' | 'css'
export type PriceStrategyUsed = 'jsonld' | 'opengraph' | 'microdata' | 'css'

export interface PriceFieldSelector {
  selector: string
  /** Attribute instead of the element text (e.g. "content"). */
  attr?: string | null
  parse?: PriceValueParse
}

export interface PriceAvailabilitySelector {
  selector: string
  attr?: string | null
  /** Values (case-insensitive, "contains") that mean "in stock". */
  inStockIf: string[]
}

/**
 * How to read one shop page. `auto` = structured data (JSON-LD, OpenGraph, microdata);
 * `css` = explicit selectors, for pages without usable structured data.
 */
export interface PriceSourceDefinition {
  version: 1
  /** `waitFor`: selector the collector waits for before reading the page (price rendered by JavaScript). */
  fetch?: { waitFor?: string }
  strategy: PriceStrategy
  price?: PriceFieldSelector
  oldPrice?: PriceFieldSelector
  title?: PriceFieldSelector
  availability?: PriceAvailabilitySelector
  currency?: string
  expected?: { title?: string; price?: number; oldPrice?: number | null; available?: boolean }
}

export interface PriceExtraction {
  title: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  available: boolean | null
  /** Where the price came from. */
  strategyUsed: PriceStrategyUsed | null
  warnings: string[]
}

export interface PriceFieldComparison {
  field: 'title' | 'price' | 'oldPrice' | 'available'
  expected: unknown
  actual: unknown
  ok: boolean
}

export type PriceErrorCode =
  | 'BLOCKED'
  | 'BLOCKED_URL'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'PRICE_NOT_FOUND'
  | 'INVALID_DEFINITION'

export type PriceScheduleKind = 'cron' | 'interval'

export interface PriceSchedule {
  kind: PriceScheduleKind
  /** For cron: 5 fields, Europe/Warsaw. */
  cron?: string
  /** For interval. */
  everyHours?: number
  /** Checks are spread randomly over this window after the scheduled time (minutes). */
  jitterMinutes: number
}

export interface PriceNotifySettings {
  telegram: boolean
  telegramChatId: string | null
  email: boolean
  emailTo: string | null
}

export interface PriceSource {
  id: string
  label: string
  url: string
  enabled: boolean
  definition: PriceSourceDefinition
  status: PriceSourceStatus
  lastError: string | null
  lastCheckedAt: string | null
  consecutiveFailures: number
  lastPrice: number | null
  lastOldPrice: number | null
  lastAvailable: boolean | null
  lastTitle: string | null
  position: number
}

export interface PriceItemSummary {
  bestPrice: number | null
  bestSourceId: string | null
  bestSourceLabel: string | null
  currency: string
  lastCheckedAt: string | null
  /** Enabled sources whose last check succeeded / enabled sources with a problem. */
  okSources: number
  problemSources: number
  /** The best price is at or below the target price. */
  targetReached: boolean
}

export interface PriceItem {
  id: string
  name: string
  description: string | null
  ean: string | null
  targetPrice: number | null
  minDropPct: number
  enabled: boolean
  notify: PriceNotifySettings
  schedule: PriceSchedule
  nextRunAt: string | null
  scheduledTaskId: string
  sources: PriceSource[]
  summary: PriceItemSummary
  createdAt: string
  updatedAt: string
}

export interface SavePriceSourceDTO {
  /** Present = an existing source to keep/update; absent = a new one. */
  id?: string
  label: string
  url: string
  enabled?: boolean
  definition?: PriceSourceDefinition
}

export interface SavePriceItemDTO {
  name: string
  description?: string | null
  ean?: string | null
  targetPrice?: number | null
  minDropPct?: number
  enabled?: boolean
  notify?: Partial<PriceNotifySettings>
  schedule: PriceSchedule
  /** The full list: sources missing from it are deleted with their history. */
  sources: SavePriceSourceDTO[]
}

/** One price change of one source (the first measurement has `previousPrice: null`). */
export interface PriceChange {
  sourceId: string
  sourceLabel: string
  at: string
  price: number
  previousPrice: number | null
  currency: string
}

/** A known shop: a ready label and a link to its search, so the product page is easy to find. */
export interface PriceShop {
  id: string
  label: string
  domain: string
  /** `{q}` is replaced with the URL-encoded item name. */
  searchUrl: string
}

export interface PriceCollectorStatus {
  lastSeenAt: string | null
  hostname: string | null
  online: boolean
  /** Set during the collector's quiet hours: it does not call the server until then. */
  quietUntil: string | null
  /** Checks waiting for the collector. */
  queued: number
}

export interface PriceOverview {
  collector: PriceCollectorStatus
  shops: PriceShop[]
  items: PriceItem[]
}

// ---------- API ↔ home collector ----------

/** Limits decided by the server; the collector has none of its own. */
export interface CollectorSettings {
  /** Pause before the next "what should I fetch?" call (during quiet hours: until they end). */
  pollSeconds: number
  /** Minimum gap between two page loads from one domain. */
  domainGapSeconds: number
  pageTimeoutSeconds: number
  maxJobsPerClaim: number
}

export interface CollectorJob {
  jobId: string
  url: string
  waitFor?: string
}

export interface CollectorClaimRequest {
  hostname?: string
}

export interface CollectorClaimResponse {
  settings: CollectorSettings
  jobs: CollectorJob[]
}

export interface CollectorResult {
  jobId: string
  /** The page was loaded (whatever its status); false = the collector could not load it. */
  ok: boolean
  httpStatus: number | null
  finalUrl: string | null
  html: string | null
  durationMs: number
  error?: { code: PriceErrorCode; message: string }
}
