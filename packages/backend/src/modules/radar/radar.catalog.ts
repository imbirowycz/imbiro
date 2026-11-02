import type { NewsCategory } from '@myorg/shared'
import { ModuleRegistry } from './core/module.registry'
import { ModuleRunner } from './core/module.runner'
import type { RadarModule } from './core/module.types'
import { createScorer } from './parsing/relevance'
import { radarConfig } from './radar.config'
import { createMorningOverviewModule } from './composites/morning-overview.module'
import { createGiosModule } from './sources/alerts/gios.module'
import { createImgwModule } from './sources/alerts/imgw.module'
import { createWarsawTransportModule } from './sources/alerts/warsaw-transport.module'
import { createNbpCurrenciesModule, createNbpGoldModule } from './sources/finance/nbp.modules'
import { createFeedModule } from './sources/news/feed-module.factory'
import { NEWS_FEEDS } from './sources/news/news.feeds'
import { createWeatherForecastModule, createWeatherNowModule } from './sources/weather/open-meteo.modules'

// The single, explicit list of radar modules and groups.
// New module = new file with a factory + one `.register(...)` line here (and a group entry).
// New RSS/Atom feed = one entry in sources/news/news.feeds.ts.
// Built at import time; a misconfiguration (duplicate id, unknown group member, cycle) stops startup.

const NEWS_GROUPS: { id: string; name: string; description: string; categories: NewsCategory[] }[] = [
  { id: 'news.poland', name: 'Polska', description: 'Wiadomości z Polski', categories: ['poland'] },
  { id: 'news.world', name: 'Świat', description: 'Wiadomości ze świata', categories: ['world'] },
  { id: 'news.warsaw', name: 'Warszawa', description: 'Wiadomości z Warszawy', categories: ['warsaw'] },
  { id: 'news.economy', name: 'Gospodarka', description: 'Wiadomości gospodarcze', categories: ['economy'] },
  { id: 'news.security', name: 'Bezpieczeństwo IT', description: 'CERT Polska i serwisy o bezpieczeństwie', categories: ['security'] },
]

export function createRadarRegistry(): ModuleRegistry {
  const news = radarConfig.news
  const scorer = createScorer(news.relevance)
  const newsModules: RadarModule<unknown>[] = NEWS_FEEDS.map((feed) => createFeedModule(feed, scorer, news.maxItemsPerFeed))

  const registry = new ModuleRegistry()
    .register(createNbpCurrenciesModule(radarConfig.finance.currencies))
    .register(createNbpGoldModule())
    .defineGroup({
      id: 'finance',
      name: 'Finanse',
      description: 'Kursy walut i cena złota z NBP',
      moduleIds: ['finance.nbp.currencies', 'finance.nbp.gold'],
    })

  for (const module of newsModules) registry.register(module)
  for (const group of NEWS_GROUPS) {
    registry.defineGroup({
      id: group.id,
      name: group.name,
      description: group.description,
      moduleIds: newsModules.filter((m) => group.categories.includes(m.category as NewsCategory)).map((m) => m.id),
    })
  }
  registry.defineGroup({
    id: 'news',
    name: 'Wszystkie wiadomości',
    description: 'Wszystkie źródła wiadomości',
    moduleIds: newsModules.map((m) => m.id),
  })

  const { location, weather, alerts } = radarConfig
  registry
    .register(createWeatherNowModule(location, weather.hours))
    .register(createWeatherForecastModule(location, weather.days))
    .register(createGiosModule({ city: location.giosCity, timeZone: location.timeZone, stationIds: alerts.giosStationIds }))
    .defineGroup({
      id: 'weather',
      name: 'Pogoda',
      description: `Pogoda teraz, prognoza i jakość powietrza – ${location.name}`,
      moduleIds: ['weather.current', 'weather.forecast', 'alerts.gios'],
    })
    .register(
      createImgwModule({
        locationName: location.name,
        timeZone: location.timeZone,
        terytPowiat: location.terytPowiat,
        voivodeship: location.voivodeship,
        hydroAreaKeywords: alerts.hydroAreaKeywords,
      })
    )
    .register(createWarsawTransportModule({ keywords: alerts.transportKeywords, maxAgeDays: alerts.transportMaxAgeDays }))
    .defineGroup({
      id: 'alerts',
      name: 'Alerty',
      description: 'Ostrzeżenia IMGW i utrudnienia w komunikacji',
      moduleIds: ['alerts.imgw', 'alerts.warsaw'],
    })

  const newsIn = (groupId: string) => registry.getGroup(groupId).moduleIds
  registry.register(
    createMorningOverviewModule({
      weather: ['weather.current'],
      alerts: { imgw: 'alerts.imgw', air: 'alerts.gios', transport: 'alerts.warsaw' },
      // "IT" = Polish IT-security sources (the English IT feeds were removed).
      news: { poland: newsIn('news.poland'), world: newsIn('news.world'), it: newsIn('news.security') },
      finance: { currencies: 'finance.nbp.currencies', gold: 'finance.nbp.gold' },
    })
  )

  return registry.validate()
}

/** One registry and one runner (with its in-memory cache) per process: API and Worker each have their own. */
export const radarRegistry = createRadarRegistry()
export const radarRunner = new ModuleRunner(radarRegistry)
