import type { PriceOfferKind } from '@myorg/shared'
import { withTransaction } from '../../db'
import { type ItemRecord, type OfferRecord, PricesRepository, type SourceRecord } from './prices.repository'

// Ocena pomiaru: czy to okazja? Reguły są czystą funkcją, a zapis respektuje dwie zasady:
// - jedna widoczna okazja danego rodzaju na źródło (niższa cena ją aktualizuje, ta sama tylko „odświeża”),
// - okazja usunięta przez użytkownika wraca dopiero przy cenie niższej niż usunięta.

export interface Measurement {
  price: number
  oldPrice: number | null
  available: boolean | null
}

export interface Previous {
  price: number | null
  available: boolean | null
}

export interface OfferCandidate {
  kind: PriceOfferKind
  price: number
  previousPrice: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function detectOffers(
  rules: { minDropPct: number; targetPrice: number | null },
  previous: Previous | null,
  current: Measurement
): OfferCandidate[] {
  // Niedostępny produkt to nie okazja, nawet jeśli cena spadła.
  if (current.available === false) return []
  const out: OfferCandidate[] = []
  const prev = previous?.price ?? null

  if (prev !== null && current.price < prev) {
    const pct = ((prev - current.price) / prev) * 100
    if (pct + 1e-9 >= rules.minDropPct && prev - current.price >= 0.005) {
      out.push({ kind: 'price_drop', price: current.price, previousPrice: prev })
    }
  }
  if (current.oldPrice !== null && current.oldPrice > current.price) {
    out.push({ kind: 'promo', price: current.price, previousPrice: current.oldPrice })
  }
  if (rules.targetPrice !== null && current.price <= rules.targetPrice) {
    out.push({ kind: 'target_reached', price: current.price, previousPrice: prev })
  }
  if (previous?.available === false && current.available === true) {
    out.push({ kind: 'back_in_stock', price: current.price, previousPrice: prev })
  }
  return out
}

export function dropOf(price: number, previousPrice: number | null): { dropAmount: number | null; dropPct: number | null } {
  if (previousPrice === null || previousPrice <= price) return { dropAmount: null, dropPct: null }
  return { dropAmount: round2(previousPrice - price), dropPct: round2(((previousPrice - price) / previousPrice) * 100) }
}

export type OfferChange = { offer: OfferRecord; change: 'new' | 'lower' }

/** Zapisuje okazje dla pomiaru; zwraca nowe i zaktualizowane (do powiadomienia). */
export async function applyOffers(
  repo: PricesRepository,
  item: ItemRecord,
  source: SourceRecord,
  current: Measurement & { title: string | null; currency: string; url: string }
): Promise<OfferChange[]> {
  const candidates = detectOffers(
    { minDropPct: item.minDropPct, targetPrice: item.targetPrice },
    { price: source.lastPrice, available: source.lastAvailable },
    current
  )
  if (candidates.length === 0) return []

  return withTransaction(async (client) => {
    const changes: OfferChange[] = []
    for (const candidate of candidates) {
      const write = {
        itemId: item.id,
        sourceId: source.id,
        kind: candidate.kind,
        title: current.title ?? source.lastTitle ?? item.name,
        url: current.url,
        price: candidate.price,
        previousPrice: candidate.previousPrice,
        ...dropOf(candidate.price, candidate.previousPrice),
        currency: current.currency,
      }
      const visible = await repo.findVisibleOffer(source.id, candidate.kind, client)
      if (visible) {
        if (candidate.price < visible.price - 0.005) {
          // Kolejny spadek: zachowujemy pierwotną „cenę przed”, żeby widać było cały spadek.
          const previousPrice = candidate.kind === 'price_drop' ? Math.max(visible.previousPrice ?? 0, candidate.previousPrice ?? 0) || null : write.previousPrice
          changes.push({ offer: await repo.replaceOffer(visible.id, { ...write, previousPrice, ...dropOf(write.price, previousPrice) }, client), change: 'lower' })
        } else {
          await repo.touchOffer(visible.id, client)
        }
        continue
      }
      const dismissedMin = await repo.minDismissedPrice(source.id, candidate.kind, client)
      if (dismissedMin !== null && candidate.price >= dismissedMin - 0.005) continue
      changes.push({ offer: await repo.insertOffer(write, client), change: 'new' })
    }
    return changes
  })
}
