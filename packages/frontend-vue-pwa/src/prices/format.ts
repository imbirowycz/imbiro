import type { PriceFetchMode, PriceOfferKind, PriceSchedule, PriceSourceStatus } from '@myorg/shared'

const locale = 'pl-PL'

export function money(value: number | null | undefined, currency = 'PLN'): string {
  if (value === null || value === undefined) return '—'
  const text = value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'PLN' ? `${text} zł` : `${text} ${currency}`
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `dziś ${time}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return `wczoraj ${time}`
  return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`
}

export const KIND_LABELS: Record<PriceOfferKind, string> = {
  price_drop: 'Obniżka',
  promo: 'Promocja',
  target_reached: 'Cena docelowa',
  back_in_stock: 'Znów dostępny',
  lowest_30d: 'Najniższa z 30 dni',
}

export const STATUS_LABELS: Record<PriceSourceStatus, string> = {
  untested: 'nie sprawdzone',
  ok: 'działa',
  warning: 'problem',
  failing: 'nie działa',
  blocked: 'zablokowane',
}

export const FETCH_MODE_LABELS: Record<PriceFetchMode, string> = {
  auto: 'Automatycznie (http, a gdy nie działa: przeglądarka)',
  http: 'Tylko zwykłe zapytanie (http)',
  browser: 'Tylko przeglądarka',
}

export const ERROR_HINTS: Record<string, string> = {
  BLOCKED: 'Sklep blokuje automatyczne zapytania. Spróbuj trybu „Tylko przeglądarka”; jeśli nadal blokuje, źródła nie da się obsłużyć z tego serwera.',
  BROWSER_UNAVAILABLE: 'Serwis przeglądarki nie działa albo nie jest skonfigurowany.',
  PRICE_NOT_FOUND: 'Strona się pobrała, ale nie ma na niej ceny według tej definicji. Wygeneruj definicję promptem „napraw”.',
  INVALID_DEFINITION: 'Definicja ma błędny selektor CSS.',
  BLOCKED_URL: 'Niedozwolony adres (tylko publiczne strony http/https).',
  TIMEOUT: 'Strona ładowała się zbyt długo.',
  NETWORK_ERROR: 'Brak połączenia ze sklepem.',
  HTTP_ERROR: 'Sklep zwrócił błąd — sprawdź, czy link jest aktualny.',
}

export function scheduleLabel(schedule: PriceSchedule): string {
  if (schedule.kind === 'interval') return `co ${schedule.everyHours} h`
  const presets: Record<string, string> = {
    '0 7,12,19 * * *': '3× dziennie (7, 12, 19)',
    '0 8 * * *': '1× dziennie (8:00)',
    '0 7,19 * * *': '2× dziennie (7, 19)',
  }
  return presets[schedule.cron ?? ''] ?? `cron ${schedule.cron}`
}
