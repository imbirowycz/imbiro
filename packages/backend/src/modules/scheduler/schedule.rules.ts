import { CronExpressionParser } from 'cron-parser'
import type { CronScheduleConfig, IntervalScheduleConfig, ScheduleType } from '@myorg/shared'

// Czyste funkcje liczenia terminów — bez bazy i bez pg-boss.

export type ScheduleSpec =
  | { scheduleType: 'once'; scheduleConfig: Record<string, never> }
  | { scheduleType: 'cron'; scheduleConfig: CronScheduleConfig }
  | { scheduleType: 'interval'; scheduleConfig: IntervalScheduleConfig }

export type ScheduleDefinition = ScheduleSpec & {
  startAt: Date
  endAt: Date | null
  timezone: string
}

// Jednorazowy termin może być minimalnie w przeszłości (opóźnienie żądania) — wtedy wykona się od razu.
export const ONCE_GRACE_MS = 60_000

export const SCHEDULE_TYPES: readonly ScheduleType[] = ['once', 'cron', 'interval']

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Zwraca komunikat błędu albo null, gdy wyrażenie jest poprawne. */
export function validateCronExpression(expression: string, timezone: string): string | null {
  if (expression.trim().split(/\s+/).length !== 5) {
    return 'Cron expression must have 5 fields: minute hour day-of-month month day-of-week'
  }
  try {
    CronExpressionParser.parse(expression, { tz: timezone })
    return null
  } catch (err) {
    return `Invalid cron expression: ${(err as Error).message}`
  }
}

/** Pierwszy termin ściśle późniejszy niż `after`, mieszczący się w [startAt, endAt]; null = brak. */
export function nextOccurrence(def: ScheduleDefinition, after: Date): Date | null {
  const candidate = rawNextOccurrence(def, after)
  if (!candidate) return null
  if (def.endAt && candidate.getTime() > def.endAt.getTime()) return null
  return candidate
}

function rawNextOccurrence(def: ScheduleDefinition, after: Date): Date | null {
  const startMs = def.startAt.getTime()
  const afterMs = after.getTime()

  switch (def.scheduleType) {
    case 'once':
      return startMs > afterMs ? def.startAt : null

    case 'interval': {
      if (afterMs < startMs) return def.startAt
      const everyMs = def.scheduleConfig.everySeconds * 1000
      const steps = Math.floor((afterMs - startMs) / everyMs) + 1
      return new Date(startMs + steps * everyMs)
    }

    case 'cron': {
      // next() zwraca termin ściśle po currentDate, więc -1 ms dopuszcza termin równy startAt.
      const from = Math.max(afterMs, startMs - 1)
      const expression = CronExpressionParser.parse(def.scheduleConfig.expression, {
        currentDate: new Date(from),
        tz: def.timezone,
      })
      return expression.next().toDate()
    }
  }
}

/** Termin planowany przy utworzeniu/zmianie/aktywacji zadania: najbliższy od `now`. */
export function initialRunAt(def: ScheduleDefinition, now: Date): Date | null {
  const after = def.scheduleType === 'once' ? now.getTime() - ONCE_GRACE_MS : now.getTime() - 1
  return nextOccurrence(def, new Date(after))
}

/**
 * Termin po wykonaniu `slot`. Pominięte terminy (np. gdy worker nie działał) nie są nadrabiane:
 * zaległy termin wykonuje się raz, a kolejny liczony jest od teraz.
 */
export function runAfter(def: ScheduleDefinition, slot: Date, now: Date): Date | null {
  const after = Math.max(slot.getTime(), now.getTime() - 1)
  return nextOccurrence(def, new Date(after))
}
