import { z } from 'zod'
import type { AirQualityStation, AlertItem, ModuleResult, NewsItem, OverviewBlock } from '@myorg/shared'
import { aggregateStatus } from '../core/module.runner'
import { defineModule } from '../core/module.types'
import { dedupeNews } from '../parsing/dedupe'
import { byRelevance } from '../parsing/relevance'
import { bySeverity } from '../sources/alerts/alert.schema'

// Composite module: runs other modules through the same runner (cache, timeouts, concurrency)
// and selects the most important pieces into blocks. It fetches nothing by itself.

export interface MorningOverviewSources {
  weather: string[]
  alerts: { imgw: string; air: string; transport: string }
  news: { poland: string[]; world: string[]; it: string[] }
  finance: { currencies: string; gold: string }
}

const blockSchema: z.ZodType<OverviewBlock> = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  itemKind: z.enum(['currency-rate', 'gold-price', 'news', 'weather-now', 'weather-day', 'alert', 'air-quality']),
  status: z.enum(['success', 'partial', 'error']),
  items: z.array(z.unknown()),
  sources: z.array(z.string()),
  attributions: z.array(z.string()),
  dataAsOf: z.string().nullable(),
  error: z.string().nullable(),
})

function block(key: string, title: string, itemKind: OverviewBlock['itemKind'], results: ModuleResult[], items: unknown[]): OverviewBlock {
  const status = aggregateStatus(results.map((r) => r.status))
  return {
    key,
    title,
    itemKind,
    status,
    items,
    sources: [...new Set(results.map((r) => r.source.name))],
    attributions: [...new Set(results.map((r) => r.source.attribution).filter((a): a is string => !!a))],
    dataAsOf: results.map((r) => r.dataAsOf).filter((d): d is string => !!d).sort().at(-1) ?? null,
    error: status === 'error' ? (results.find((r) => r.error)?.error?.message ?? 'Źródła niedostępne') : null,
  }
}

/** One summary line for air quality: the worst station decides. */
function airSummary(stations: AirQualityStation[]): AlertItem | null {
  const worst = stations[0]
  if (!worst?.indexCategory) return null
  return {
    id: `gios-air-${worst.stationId}`,
    source: 'GIOŚ',
    category: 'air',
    title: `Jakość powietrza: ${worst.indexCategory.toLowerCase()} (najgorzej: ${worst.name})`,
    description: null,
    severity: worst.severity,
    location: 'Warszawa',
    issuedAt: worst.measuredAt,
    validFrom: null,
    expiresAt: null,
    url: 'https://powietrze.gios.gov.pl',
  }
}

export function createMorningOverviewModule(sources: MorningOverviewSources, topNews = 3, transportAlerts = 3) {
  const newsIds = [...sources.news.poland, ...sources.news.world, ...sources.news.it]
  const all = [
    ...sources.weather,
    sources.alerts.imgw,
    sources.alerts.air,
    sources.alerts.transport,
    sources.finance.currencies,
    sources.finance.gold,
    ...newsIds,
  ]

  return defineModule<OverviewBlock>({
    id: 'morning.overview',
    name: 'Poranny przegląd',
    group: 'overview',
    description: 'Pogoda, alerty, najważniejsze wiadomości (Polska, świat, IT) i finanse w jednym raporcie',
    source: { name: 'Personal Radar', homepage: '/' },
    itemKind: 'overview-block',
    kind: 'composite',
    allowedHosts: [],
    dependsOn: all,
    itemSchema: blockSchema,
    cacheTtlSeconds: 5 * 60,
    // Children run with their own timeouts; this only bounds the whole overview.
    timeoutMs: 60_000,

    async execute({ run }) {
      const result = await run({ kind: 'modules', ids: all })
      const byId = new Map(result.results.map((r) => [r.moduleId, r]))
      const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((r): r is ModuleResult => !!r)

      // News: deduplicate across all news modules first, so one story is not shown twice.
      const seen = new Set<string>()
      const topOf = (ids: string[]) => {
        const items = dedupeNews(pick(ids).flatMap((r) => r.data as NewsItem[]))
          .filter((item) => !seen.has(item.url))
          .sort(byRelevance)
          .slice(0, topNews)
        items.forEach((item) => seen.add(item.url))
        return items
      }

      const imgw = pick([sources.alerts.imgw])
      const air = pick([sources.alerts.air])
      const transport = pick([sources.alerts.transport])
      const alerts = [
        // Only real warnings (yellow and above); informational ones stay on the dashboard.
        ...imgw.flatMap((r) => (r.data as AlertItem[]).filter((a) => a.severity !== 'info')),
        ...air.map((r) => airSummary(r.data as AirQualityStation[])).filter((a): a is AlertItem => !!a),
        ...transport.flatMap((r) => (r.data as AlertItem[]).slice(0, transportAlerts)),
      ].sort(bySeverity)

      const currencies = pick([sources.finance.currencies])
      const gold = pick([sources.finance.gold])
      const weather = pick(sources.weather)

      const blocks: OverviewBlock[] = [
        block('weather', 'Pogoda', 'weather-now', weather, weather.flatMap((r) => r.data)),
        block('alerts', 'Alerty', 'alert', [...imgw, ...air, ...transport], alerts),
        block('poland', 'Polska – najważniejsze', 'news', pick(sources.news.poland), topOf(sources.news.poland)),
        block('world', 'Świat – najważniejsze', 'news', pick(sources.news.world), topOf(sources.news.world)),
        block('it', 'IT – najważniejsze', 'news', pick(sources.news.it), topOf(sources.news.it)),
        block('currencies', 'Kursy walut', 'currency-rate', currencies, currencies.flatMap((r) => r.data)),
        block('gold', 'Złoto', 'gold-price', gold, gold.flatMap((r) => r.data)),
      ]

      const failed = result.results.filter((r) => r.status === 'error')
      return {
        data: blocks,
        warnings: failed.length > 0 ? [`Niedostępne źródła: ${failed.map((r) => r.moduleId).join(', ')}`] : [],
      }
    },
  })
}
