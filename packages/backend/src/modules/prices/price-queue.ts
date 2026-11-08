import type { Db, PgBoss } from 'pg-boss'
import { QUEUES } from '../../boss'

// Kolejka sprawdzeń źródeł. Instancję pg-boss podpinają procesy API i Workera przy starcie.

export interface PriceCheckJobData {
  sourceId: string
  /** schedule = z harmonogramu, now = „Sprawdź teraz”, confirm = ponowne sprawdzenie podejrzanego wyniku. */
  reason: 'schedule' | 'now' | 'confirm'
  /** Tylko confirm: cena, która wyglądała podejrzanie. */
  suspectPrice?: number
}

let boss: PgBoss | null = null

export function bindPriceQueue(instance: PgBoss): void {
  boss = instance
}

function requireBoss(): PgBoss {
  if (!boss) throw new Error('Price queue is not bound (bindPriceQueue)')
  return boss
}

export async function enqueuePriceCheck(
  data: PriceCheckJobData,
  options: { startAfter?: Date; db?: Db } = {}
): Promise<string | null> {
  const key = data.reason === 'schedule' ? data.sourceId : `${data.sourceId}:${data.reason}`
  return requireBoss().send(QUEUES.priceCheck, data, {
    singletonKey: key,
    startAfter: options.startAfter,
    db: options.db,
  })
}

/**
 * Rozkłada sprawdzenia źródeł w oknie losowania: każde źródło dostaje losowy termin, a kolejne
 * terminy są od siebie oddalone co najmniej o `minGapSeconds` (nie wszystko o tej samej minucie).
 */
export function spreadStarts(count: number, base: Date, jitterMinutes: number, minGapSeconds = 45, random = Math.random): Date[] {
  const windowMs = Math.max(0, jitterMinutes) * 60_000
  const offsets = Array.from({ length: count }, () => Math.floor(random() * windowMs)).sort((a, b) => a - b)
  for (let i = 1; i < offsets.length; i++) {
    offsets[i] = Math.max(offsets[i], offsets[i - 1] + minGapSeconds * 1000)
  }
  // Losowa kolejność źródeł — przypisanie terminów nie zależy od kolejności na liście.
  const shuffled = offsets.map((o) => ({ o, r: random() })).sort((a, b) => a.r - b.r).map((x) => x.o)
  return shuffled.map((offset) => new Date(base.getTime() + offset))
}
