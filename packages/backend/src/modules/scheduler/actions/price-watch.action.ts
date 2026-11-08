import { z } from 'zod'
import { pool } from '../../../db'
import { enqueuePriceCheck, spreadStarts } from '../../prices/price-queue'
import { parseWith } from './action.registry'
import type { ActionHandler } from './action.types'

const configSchema = z.strictObject({ itemId: z.uuid() })

export type PriceWatchConfig = z.output<typeof configSchema>

/**
 * Termin harmonogramu artykułu Łowcy cen. Niczego nie pobiera: dla każdego źródła wrzuca
 * osobne zadanie `prices.check` z losowym terminem w oknie — awaria jednego źródła nie
 * wpływa na pozostałe.
 */
export function createPriceWatchAction(): ActionHandler<PriceWatchConfig> {
  return {
    type: 'price.watch',
    description: 'Łowca cen: planuje sprawdzenie wszystkich źródeł artykułu',
    validateConfig: (raw) => parseWith(configSchema, raw),

    async execute(context, { itemId }) {
      const item = await pool.query<{ enabled: boolean; jitter_minutes: number }>(
        'SELECT enabled, jitter_minutes FROM price_items WHERE id = $1',
        [itemId]
      )
      const row = item.rows[0]
      if (!row) return { skipped: 'item no longer exists' }
      if (!row.enabled) return { skipped: 'item disabled' }

      const sources = await pool.query<{ id: string }>('SELECT id FROM price_sources WHERE item_id = $1', [itemId])
      const starts = spreadStarts(sources.rows.length, new Date(), row.jitter_minutes)
      let enqueued = 0
      for (const [index, source] of sources.rows.entries()) {
        if (await enqueuePriceCheck({ sourceId: source.id, reason: 'schedule' }, { startAfter: starts[index] })) enqueued++
      }
      context.log(`price.watch ${itemId}: ${enqueued}/${sources.rows.length} checks enqueued`)
      return { sources: sources.rows.length, enqueued }
    },
  }
}
