import { z } from 'zod'
import { parseWith, type ActionHandler } from '../scheduler'
import { type PriceQueue, spreadStarts } from './price-queue'
import type { PricesRepository } from './prices.repository'

const configSchema = z.strictObject({ itemId: z.uuid() })

export type PriceWatchConfig = z.output<typeof configSchema>

export const PRICE_WATCH_ACTION = 'price.watch'

/**
 * The scheduled run of one tracked item. Fetches nothing: for every enabled source it queues
 * a separate check at a random time within the item's window. The home collector picks the
 * checks up, so a failing source does not affect the others.
 */
export function createPriceWatchAction(deps: { repo: PricesRepository; queue: PriceQueue }): ActionHandler<PriceWatchConfig> {
  return {
    type: PRICE_WATCH_ACTION,
    description: 'Okazje: planuje sprawdzenie wszystkich źródeł artykułu',
    validateConfig: (raw) => parseWith(configSchema, raw),

    async execute(context, { itemId }) {
      const item = await deps.repo.findItem(itemId)
      if (!item) return { skipped: 'item no longer exists' }
      if (!item.enabled) return { skipped: 'item disabled' }

      const sources = (await deps.repo.listSources([itemId])).filter((source) => source.enabled)
      const starts = spreadStarts(sources.length, new Date(), item.jitterMinutes)
      let enqueued = 0
      for (const [index, source] of sources.entries()) {
        if (await deps.queue.enqueue({ sourceId: source.id, reason: 'schedule' }, { startAfter: starts[index] })) enqueued++
      }
      context.log(`price.watch ${itemId}: ${enqueued}/${sources.length} checks enqueued`)
      return { sources: sources.length, enqueued }
    },
  }
}
