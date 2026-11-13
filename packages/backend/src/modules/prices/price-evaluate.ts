import type { PriceOfferKind } from '@myorg/shared'
import { withTransaction } from '../../core/db'
import type { ItemRecord, OfferRecord, PricesRepository, SourceRecord } from './prices.repository'

// Is a measurement a deal? The rules are a pure function; saving follows two principles:
// - one visible offer of a kind per source (a lower price updates it, the same price only "refreshes" it),
// - a dismissed offer comes back only at a price lower than the dismissed one.

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
  // An unavailable product is not a deal, even if the price dropped.
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

/** Saves the offers of a measurement; returns the new and the updated ones (to notify about). */
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
          // A further drop: keep the original "price before", so the whole drop stays visible.
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
