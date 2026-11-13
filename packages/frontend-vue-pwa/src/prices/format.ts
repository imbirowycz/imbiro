import type { PriceSchedule, PriceShop, PriceSource, PriceSourceDefinition } from '@myorg/shared'

export function money(value: number | null, currency = 'PLN'): string {
  if (value === null) return '—'
  // pl-PL groups thousands only from 10 000 up by default; prices read better grouped always.
  const amount = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(value)
  return `${amount} ${currency === 'PLN' ? 'zł' : currency}`
}

export type SourceTone = 'ok' | 'warn' | 'fail' | 'idle'

/** What the last fetch of a source looked like — one label and one colour. */
export function sourceState(source: PriceSource): { label: string; tone: SourceTone } {
  if (!source.enabled) return { label: 'wyłączone', tone: 'idle' }
  switch (source.status) {
    case 'ok':
      return source.lastAvailable === false ? { label: 'niedostępny', tone: 'warn' } : { label: 'pobrano', tone: 'ok' }
    case 'warning':
      return { label: 'nie pobrano', tone: 'warn' }
    case 'failing':
      return { label: 'nie działa', tone: 'fail' }
    case 'blocked':
      return { label: 'blokada', tone: 'fail' }
    default:
      return { label: 'czeka na sprawdzenie', tone: 'idle' }
  }
}

// Schedule presets of the form. The value is a compact key: "cron:<expr>" or "every:<hours>".
export const SCHEDULE_PRESETS: { value: string; label: string }[] = [
  { value: 'cron:0 7,12,19 * * *', label: '3× dziennie (7:00, 12:00, 19:00)' },
  { value: 'every:1', label: 'co godzinę' },
  { value: 'every:3', label: 'co 3 godziny' },
  { value: 'every:6', label: 'co 6 godzin' },
  { value: 'every:12', label: 'co 12 godzin' },
  { value: 'every:24', label: 'raz na dobę' },
]

export function scheduleKey(schedule: PriceSchedule): string {
  return schedule.kind === 'cron' ? `cron:${schedule.cron}` : `every:${schedule.everyHours}`
}

export function scheduleFromKey(key: string, jitterMinutes: number): PriceSchedule {
  const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  return kind === 'cron' ? { kind: 'cron', cron: value, jitterMinutes } : { kind: 'interval', everyHours: Number(value), jitterMinutes }
}

export function scheduleLabel(schedule: PriceSchedule): string {
  const key = scheduleKey(schedule)
  return SCHEDULE_PRESETS.find((preset) => preset.value === key)?.label ?? (schedule.kind === 'cron' ? `cron ${schedule.cron}` : `co ${schedule.everyHours} godz.`)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The known shop a product address belongs to (by domain), if any. */
export function shopOf(url: string, shops: PriceShop[]): PriceShop | undefined {
  const host = hostOf(url)
  return shops.find((shop) => host === shop.domain || host.endsWith(`.${shop.domain}`))
}

export function searchLink(shop: PriceShop, itemName: string): string {
  return shop.searchUrl.replace('{q}', encodeURIComponent(itemName.trim()))
}

/** `auto` reads structured data; a price selector switches the source to explicit CSS. */
export function definitionFor(priceSelector: string): PriceSourceDefinition {
  const selector = priceSelector.trim()
  return selector ? { version: 1, strategy: 'css', price: { selector } } : { version: 1, strategy: 'auto' }
}
