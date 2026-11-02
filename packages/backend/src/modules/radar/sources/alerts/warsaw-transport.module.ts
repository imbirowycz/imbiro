import type { AlertItem } from '@myorg/shared'
import { mapWithLimit } from '../../core/module.runner'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { dedupeNews } from '../../parsing/dedupe'
import { parseFeed } from '../../parsing/feed.parser'
import { byDateDesc, normalizeFeedEntry } from '../../parsing/news.normalize'
import { keywordMatcher } from '../../parsing/relevance'
import { alertItemSchema } from './alert.schema'

// Warsaw has no public, key-less disruption API (Warszawa 19115 / api.um.warszawa.pl need a key;
// um.warszawa.pl/rss is gone). ZTM and WTP publish route changes in their RSS feeds next to
// press releases — we keep only entries that look like disruptions (keyword filter).

const FEEDS = [
  { name: 'ZTM Warszawa', url: 'https://www.ztm.waw.pl/feed/' },
  { name: 'WTP Warszawa', url: 'https://www.wtp.waw.pl/feed/' },
] as const

export interface WarsawTransportOptions {
  keywords: readonly string[]
  maxAgeDays: number
}

export function createWarsawTransportModule(options: WarsawTransportOptions) {
  const matchers = options.keywords.map(keywordMatcher)

  return defineModule<AlertItem>({
    id: 'alerts.warsaw',
    name: 'Komunikacja – Warszawa',
    group: 'alerts',
    category: 'transport',
    description: 'Zmiany w kursowaniu, objazdy i utrudnienia z komunikatów ZTM i WTP',
    source: { name: 'ZTM / WTP', homepage: 'https://www.ztm.waw.pl' },
    itemKind: 'alert',
    kind: 'collector',
    allowedHosts: FEEDS.map((feed) => new URL(feed.url).hostname),
    itemSchema: alertItemSchema,
    cacheTtlSeconds: 30 * 60,

    async execute({ http, signal, now }) {
      const settled = await mapWithLimit(FEEDS, 2, async (feed) => {
        const response = await http.getText(feed.url, { signal, accept: 'application/rss+xml, application/xml;q=0.9' })
        const parsed = parseFeed(response.text)
        return parsed.entries
          .map((entry) => normalizeFeedEntry(entry, { source: feed.name, category: 'warsaw', baseUrl: feed.url, summaryMaxLength: 400 }))
          .filter((item) => item !== null)
      })
      const failed = settled.filter((s) => s.status === 'rejected')
      if (failed.length === settled.length) {
        const reason = (failed[0] as PromiseRejectedResult).reason
        throw reason instanceof RadarSourceError ? reason : new RadarSourceError('NETWORK_ERROR', 'ZTM i WTP nie odpowiadają')
      }

      const minDate = new Date(now().getTime() - options.maxAgeDays * 24 * 3600_000).toISOString()
      const entries = dedupeNews(settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])))
        .filter((item) => !item.publishedAt || item.publishedAt >= minDate)
        .filter((item) => matchers.some((m) => m.test(item.title) || (!!item.summary && m.test(item.summary))))
        .sort(byDateDesc)

      const data: AlertItem[] = entries.map((item) => ({
        id: `${item.source}:${item.id}`,
        source: item.source,
        category: 'transport',
        title: item.title,
        description: item.summary,
        severity: 'info',
        location: 'Warszawa',
        issuedAt: item.publishedAt,
        validFrom: null,
        expiresAt: null,
        url: item.url,
      }))

      return {
        data,
        warnings: failed.length > 0 ? [`Nie udało się pobrać: ${FEEDS.filter((_, i) => settled[i].status === 'rejected').map((f) => f.name).join(', ')}`] : [],
      }
    },
  })
}
