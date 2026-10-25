import type { ExecutionStatus, ScheduledTask } from '@myorg/shared'

const locale = 'pl-PL'

export const ACTION_LABELS: Record<string, string> = {
  'email.send': 'Email',
  'telegram.send': 'Telegram',
  'report.generate': 'Raport',
}

export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: 'w kolejce',
  running: 'trwa',
  succeeded: 'udane',
  failed: 'błąd',
}

export function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/** „dziś”, „jutro” albo data — obok dużej godziny na tablicy. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return 'dziś'
  if (days === 1) return 'jutro'
  if (days === -1) return 'wczoraj'
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return seconds >= 0 ? 'za chwilę' : 'przed chwilą'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86_400), 'day')
}

export function duration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

export function intervalLabel(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? 'codziennie' : `co ${seconds / 86_400} dni`
  if (seconds % 3600 === 0) return seconds === 3600 ? 'co godzinę' : `co ${seconds / 3600} godz.`
  if (seconds % 60 === 0) return `co ${seconds / 60} min`
  return `co ${seconds} s`
}

/** Opis harmonogramu po ludzku, np. „cron 0 8 * * * (Europe/Warsaw)”. */
export function scheduleLabel(task: ScheduledTask): string {
  const config = task.scheduleConfig as { expression?: string; everySeconds?: number }
  switch (task.scheduleType) {
    case 'once':
      return `jednorazowo, ${dateTime(task.startAt)}`
    case 'cron':
      return `cron ${config.expression} (${task.timezone})`
    case 'interval':
      return intervalLabel(config.everySeconds ?? 0)
  }
}

/** Stan zadania na tablicy, gdy nie ma najbliższego terminu. */
export function idleLabel(task: ScheduledTask): string {
  return task.enabled ? 'zakończone' : 'wyłączone'
}
