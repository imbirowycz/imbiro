// Łowca cen: typy wspólne dla API i frontendu. Walidacja (zod) jest w backendzie:
// packages/backend/src/modules/prices/prices.schemas.ts

/** Jak pobierać stronę: auto = najpierw http, przy blokadzie albo braku ceny przeglądarka. */
export type PriceFetchMode = 'auto' | 'http' | 'browser'
export type PriceFetcher = 'http' | 'browser'
export type PriceSourceStatus = 'untested' | 'ok' | 'warning' | 'failing' | 'blocked'
export type PriceOfferKind = 'price_drop' | 'promo' | 'target_reached' | 'back_in_stock' | 'lowest_30d'
export type PriceValueParse = 'pl-price' | 'number' | 'text'
export type PriceStrategy = 'auto' | 'css'
export type PriceStrategyUsed = 'jsonld' | 'opengraph' | 'microdata' | 'css'

export interface PriceFieldSelector {
  selector: string
  /** Atrybut zamiast tekstu elementu (np. "content"). */
  attr?: string | null
  parse?: PriceValueParse
}

export interface PriceAvailabilitySelector {
  selector: string
  attr?: string | null
  /** Wartości (bez rozróżniania wielkości liter, „zawiera”) oznaczające „dostępny”. */
  inStockIf: string[]
}

/** Definicja źródła (generowana przez AI) — „instrukcja obsługi” jednego sklepu. */
export interface PriceSourceDefinition {
  version: 1
  source?: { shop?: string; domain?: string }
  fetch?: { mode?: PriceFetchMode; waitFor?: string; reason?: string }
  strategy: PriceStrategy
  price?: PriceFieldSelector
  oldPrice?: PriceFieldSelector
  title?: PriceFieldSelector
  availability?: PriceAvailabilitySelector
  currency?: string
  expected?: { title?: string; price?: number; oldPrice?: number | null; available?: boolean }
  confidence?: 'high' | 'medium' | 'low'
  notes?: string
  /** Wersja promptu, z której powstała definicja (dopisywana przez aplikację). */
  promptVersion?: number
}

export interface PriceExtraction {
  title: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  available: boolean | null
  /** Skąd pochodzi cena. */
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
  | 'BROWSER_UNAVAILABLE'
  | 'INVALID_DEFINITION'
  | 'CANCELLED'

export interface PriceFetchAttempt {
  fetcher: PriceFetcher
  ok: boolean
  httpStatus: number | null
  durationMs: number
  error: { code: PriceErrorCode; message: string } | null
}

export interface PriceSourceTestResult {
  ok: boolean
  fetcher: PriceFetcher | null
  httpStatus: number | null
  finalUrl: string | null
  durationMs: number
  extraction: PriceExtraction | null
  comparison: PriceFieldComparison[]
  /** Selektory definicji i liczba trafionych elementów (powinno być 1). */
  selectorMatches: { field: string; selector: string; count: number }[]
  attempts: PriceFetchAttempt[]
  error: { code: PriceErrorCode; message: string } | null
}

export interface PriceSnapshot {
  url: string
  finalUrl: string
  fetcher: PriceFetcher
  httpStatus: number
  html: string
  jsonLd: string[]
  truncated: boolean
}

export interface PricePromptDTO {
  mode: 'new' | 'repair'
  url: string
  shop?: string
  fetchMode?: PriceFetchMode
  item: { name: string; description?: string | null; ean?: string | null }
  /** Tylko dla repair. */
  sourceId?: string
  currentDefinition?: unknown
}

export interface PricePromptResult {
  prompt: string
  promptVersion: number
  snapshot: { fetcher: PriceFetcher; httpStatus: number; truncated: boolean } | null
  /** Strona nie dała się pobrać — prompt zawiera wtedy informację zamiast HTML. */
  fetchError: { code: PriceErrorCode; message: string } | null
}

export type PriceScheduleKind = 'cron' | 'interval'

export interface PriceSchedule {
  kind: PriceScheduleKind
  /** Dla cron: 5 pól, strefa Europe/Warsaw. */
  cron?: string
  /** Dla interval. */
  everyHours?: number
  /** Losowe przesunięcie sprawdzeń w oknie po terminie (minuty). */
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
  fetchMode: PriceFetchMode
  preferredFetcher: PriceFetcher
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
  problemSources: number
  activeOffers: number
  unreadOffers: number
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
  id?: string
  label: string
  url: string
  fetchMode: PriceFetchMode
  definition: PriceSourceDefinition
}

export interface SavePriceItemDTO {
  name: string
  description?: string | null
  ean?: string | null
  targetPrice?: number | null
  minDropPct?: number
  enabled?: boolean
  notify: PriceNotifySettings
  schedule: PriceSchedule
  sources: SavePriceSourceDTO[]
}

export interface PriceOffer {
  id: string
  itemId: string
  itemName: string
  sourceId: string
  sourceLabel: string
  kind: PriceOfferKind
  title: string
  url: string
  price: number
  previousPrice: number | null
  dropAmount: number | null
  dropPct: number | null
  currency: string
  detectedAt: string
  lastSeenAt: string
  readAt: string | null
  /** Ostatnia zmierzona cena w tym źródle (informacyjnie). */
  currentPrice: number | null
  currentCheckedAt: string | null
}

export interface PriceObservation {
  id: string
  checkedAt: string
  ok: boolean
  price: number | null
  oldPrice: number | null
  available: boolean | null
  fetcher: PriceFetcher | null
  durationMs: number | null
  errorCode: string | null
  error: string | null
}

export interface PriceOfferPage {
  offers: PriceOffer[]
  nextCursor: string | null
}

export type PriceDiscoveryStatus = 'found' | 'not_found' | 'blocked' | 'error'

export interface PriceDiscoveryCandidate {
  shop: string
  /** Strona produktu w sklepie (null, gdy nie znaleziono). */
  url: string | null
  status: PriceDiscoveryStatus
  /** ceneo = strona porównywarki; search = wyszukiwarka sklepu. */
  via: 'ceneo' | 'search'
  /** Cena z listy ofert Ceneo (orientacyjnie). */
  ceneoPrice: number | null
  /** Wynik sprawdzenia znalezionej strony (tryb auto). */
  check: PriceSourceTestResult | null
  message: string | null
}

export interface PriceDiscoveryResult {
  query: string
  ceneoUrl: string | null
  candidates: PriceDiscoveryCandidate[]
  durationMs: number
  /** Przerwano po limicie czasu — część sklepów nie została sprawdzona. */
  timedOut: boolean
}

export interface PriceDiscoveryDTO {
  name: string
  ean?: string | null
  description?: string | null
  /** Adresy już dodanych źródeł — ich sklepy są pomijane. */
  existingUrls?: string[]
}
