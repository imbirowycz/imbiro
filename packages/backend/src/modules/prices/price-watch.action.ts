import { z } from 'zod'
import { parseWith, type ActionHandler } from '../scheduler'
import { type PriceQueue, spreadStarts } from './price-queue'
import type { PricesRepository } from './prices.repository'

const configSchema = z.strictObject({ itemId: z.uuid() })

export type PriceWatchConfig = z.output<typeof configSchema>

export const PRICE_WATCH_ACTION = 'price.watch'

/**
 * A source the shop blocks is re-checked about once a day instead of at every run — knocking
 * on a closed door three times a day only prolongs the block. Below 24 h, so that the check
 * lands on the same daily run despite the random spread.
 */
const BLOCKED_RECHECK_MS = 20 * 3_600_000

/**
 * The scheduled run of one tracked item. Fetches nothing: for every enabled source it queues
 * a separate check at a random time within the item's window. The home collector picks the
 * checks up, so a failing source does not affect the others.
 */
export function createPriceWatchAction(deps: { repo: PricesRepository; queue: PriceQueue; now?: () => Date }): ActionHandler<PriceWatchConfig> {
  const now = deps.now ?? (() => new Date())

  return {
    type: PRICE_WATCH_ACTION,
    description: 'Okazje: planuje sprawdzenie wszystkich źródeł artykułu',
    validateConfig: (raw) => parseWith(configSchema, raw),

    async execute(context, { itemId }) {
      const item = await deps.repo.findItem(itemId)
      if (!item) return { skipped: 'item no longer exists' }
      if (!item.enabled) return { skipped: 'item disabled' }

      const enabled = (await deps.repo.listSources([itemId])).filter((source) => source.enabled)
      const restUntil = now().getTime() - BLOCKED_RECHECK_MS
      const sources = enabled.filter((source) => !(source.status === 'blocked' && source.lastCheckedAt && source.lastCheckedAt.getTime() > restUntil))
      const starts = spreadStarts(sources.length, now(), item.jitterMinutes)
      let enqueued = 0
      for (const [index, source] of sources.entries()) {
        if (await deps.queue.enqueue({ sourceId: source.id, reason: 'schedule' }, { startAfter: starts[index] })) enqueued++
      }
      const resting = enabled.length - sources.length
      context.log(`price.watch ${itemId}: ${enqueued}/${sources.length} checks enqueued, ${resting} blocked source(s) resting`)
      return { sources: sources.length, enqueued, resting }
    },
  }
}
