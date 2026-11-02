import type { AlertSeverity } from '@myorg/shared'

const locale = 'pl-PL'
const timeZone = 'Europe/Warsaw'

export const number = (value: number, digits: number) =>
  value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** 7.94 → "7,9°", 8 → "8°" */
export function degrees(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${number(rounded, Number.isInteger(rounded) ? 0 : 1)}°`
}

/** Signed change with a real minus sign, e.g. "+0,0230" / "−7,58". */
export function change(value: number | null, digits: number): string {
  if (value === null) return ''
  if (value === 0) return 'bez zmian'
  return `${value > 0 ? '+' : '−'}${number(Math.abs(value), digits)}`
}

/** Today: "12:29"; other days: "27 paź" (the hour matters less for older items). */
export function shortWhen(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameDay = date.toLocaleDateString(locale, { timeZone }) === now.toLocaleDateString(locale, { timeZone })
  return sameDay
    ? date.toLocaleTimeString(locale, { timeZone, hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { timeZone, day: 'numeric', month: 'short' })
}

/** Alert validity: always with the hour ("3 lis, 10:00"). */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale, { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function hour(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale, { timeZone, hour: '2-digit', minute: '2-digit' })
}

/** "2026-11-03" → "wt 3.11" */
export function dayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, { weekday: 'short', timeZone })
  return `${weekday.replace('.', '')} ${d}.${m}`
}

export function dateOnly(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d}.${m}.${y}`
}

export function longToday(now = new Date()): string {
  return now.toLocaleDateString(locale, { timeZone, weekday: 'long', day: 'numeric', month: 'long' })
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  high: 'ostrzeżenie czerwone',
  medium: 'ostrzeżenie pomarańczowe',
  low: 'ostrzeżenie żółte',
  info: 'informacja',
}
