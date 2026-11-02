import { z } from 'zod'
import type { CurrencyRate, GoldPrice } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'

// Official NBP API (https://api.nbp.pl): free, no API key, JSON.
// Tables are published on business days around 12:15, so before that (and on weekends)
// the latest table is from an earlier day — we always return the real quotation date.

const NBP_HOST = 'api.nbp.pl'
const NBP_SOURCE = { name: 'NBP', homepage: 'https://nbp.pl' }
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// ---- Upstream response schemas (only the fields we use) ----

const exchangeTablesSchema = z
  .array(
    z.object({
      table: z.string(),
      no: z.string(),
      effectiveDate: DATE,
      rates: z.array(z.object({ currency: z.string(), code: z.string(), mid: z.number().positive() })),
    })
  )
  .min(1)

const goldPricesSchema = z.array(z.object({ data: DATE, cena: z.number().positive() })).min(1)

// ---- Normalized item schemas ----

export const currencyRateSchema: z.ZodType<CurrencyRate> = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  mid: z.number().positive(),
  change: z.number().nullable(),
  effectiveDate: DATE,
  tableNo: z.string().min(1),
})

export const goldPriceSchema: z.ZodType<GoldPrice> = z.object({
  date: DATE,
  pricePerGram: z.number().positive(),
  change: z.number().nullable(),
})

/** Rounds a difference of two rates so 4.3955 - 4.3901 does not show float noise. */
function diff(current: number, previous: number | undefined, decimals: number): number | null {
  if (previous === undefined) return null
  const factor = 10 ** decimals
  return Math.round((current - previous) * factor) / factor
}

export function createNbpCurrenciesModule(currencies: readonly string[]) {
  return defineModule<CurrencyRate>({
    id: 'finance.nbp.currencies',
    name: 'Kursy walut NBP',
    group: 'finance',
    category: 'currencies',
    description: `Średnie kursy ${currencies.join(', ')} z tabeli A NBP wraz ze zmianą względem poprzedniej tabeli`,
    source: NBP_SOURCE,
    itemKind: 'currency-rate',
    kind: 'collector',
    allowedHosts: [NBP_HOST],
    itemSchema: currencyRateSchema,
    cacheTtlSeconds: 30 * 60,

    async execute({ http, signal }) {
      // Two most recent tables in one request: the latest rates plus the previous ones for the change.
      const tables = await http.getJson(
        `https://${NBP_HOST}/api/exchangerates/tables/A/last/2/?format=json`,
        exchangeTablesSchema,
        { signal }
      )
      const sorted = [...tables].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
      const latest = sorted[sorted.length - 1]
      const previous = sorted.length > 1 ? sorted[sorted.length - 2] : undefined

      const warnings: string[] = []
      const data: CurrencyRate[] = []
      for (const code of currencies) {
        const rate = latest.rates.find((r) => r.code === code)
        if (!rate) {
          warnings.push(`Brak waluty ${code} w tabeli ${latest.no}`)
          continue
        }
        const before = previous?.rates.find((r) => r.code === code)?.mid
        data.push({
          code: rate.code,
          name: rate.currency,
          mid: rate.mid,
          change: diff(rate.mid, before, 4),
          effectiveDate: latest.effectiveDate,
          tableNo: latest.no,
        })
      }
      if (data.length === 0) throw new RadarSourceError('INVALID_RESPONSE', 'Tabela NBP nie zawiera żadnej z wybranych walut')

      return { data, warnings, dataAsOf: latest.effectiveDate }
    },
  })
}

export function createNbpGoldModule() {
  return defineModule<GoldPrice>({
    id: 'finance.nbp.gold',
    name: 'Cena złota NBP',
    group: 'finance',
    category: 'gold',
    description: 'Cena 1 g złota (próba 1000) wyliczona przez NBP, ze zmianą względem poprzedniego notowania',
    source: NBP_SOURCE,
    itemKind: 'gold-price',
    kind: 'collector',
    allowedHosts: [NBP_HOST],
    itemSchema: goldPriceSchema,
    cacheTtlSeconds: 30 * 60,

    async execute({ http, signal }) {
      const prices = await http.getJson(`https://${NBP_HOST}/api/cenyzlota/last/2/?format=json`, goldPricesSchema, {
        signal,
      })
      const sorted = [...prices].sort((a, b) => a.data.localeCompare(b.data))
      const latest = sorted[sorted.length - 1]
      const previous = sorted.length > 1 ? sorted[sorted.length - 2] : undefined

      return {
        data: [{ date: latest.data, pricePerGram: latest.cena, change: diff(latest.cena, previous?.cena, 2) }],
        dataAsOf: latest.data,
      }
    },
  })
}
