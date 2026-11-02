import type { NewsCategory, NewsItem } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { dedupeNews } from '../../parsing/dedupe'
import { parseFeed } from '../../parsing/feed.parser'
import { byDateDesc, isRecent, normalizeFeedEntry } from '../../parsing/news.normalize'
import type { NewsScorer } from '../../parsing/relevance'
import { newsItemSchema } from './news.schema'

// One generic module for any RSS/Atom feed. Adding a feed = adding a FeedDefinition, no new code.

export interface FeedDefinition {
  id: string
  name: string
  category: NewsCategory
  url: string
  source: { name: string; homepage: string }
  description: string
  /** e.g. "Vite" for GitHub releases whose titles are just version tags. */
  titlePrefix?: string
  cacheTtlMinutes?: number
  maxBytes?: number
  /** Extra hosts the feed is known to redirect to. */
  extraHosts?: string[]
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'

export interface FeedModuleLimits {
  maxItems: number
  /** Older items are dropped; undated ones are kept. */
  maxAgeDays: number
}

export function createFeedModule(feed: FeedDefinition, scorer: NewsScorer, { maxItems, maxAgeDays }: FeedModuleLimits) {
  return defineModule<NewsItem>({
    id: feed.id,
    name: feed.name,
    group: 'news',
    category: feed.category,
    description: feed.description,
    source: feed.source,
    itemKind: 'news',
    kind: 'collector',
    allowedHosts: [new URL(feed.url).hostname, ...(feed.extraHosts ?? [])],
    itemSchema: newsItemSchema,
    cacheTtlSeconds: (feed.cacheTtlMinutes ?? 15) * 60,

    async execute({ http, signal, now }) {
      const response = await http.getText(feed.url, { signal, accept: FEED_ACCEPT, maxBytes: feed.maxBytes })
      const parsed = parseFeed(response.text)
      const baseUrl = parsed.link ?? response.url

      const normalized = parsed.entries.map((entry) =>
        normalizeFeedEntry(entry, { source: feed.source.name, category: feed.category, baseUrl, titlePrefix: feed.titlePrefix })
      )
      const usable = normalized.filter((item) => item !== null)
      const warnings: string[] = []
      const skipped = normalized.length - usable.length
      if (skipped > 0) warnings.push(`Pominięto ${skipped} wpisów bez tytułu lub linku`)

      const at = now()
      const items = dedupeNews(usable)
        .filter((item) => isRecent(item, at, maxAgeDays) && !scorer.isExcluded(item))
        .sort(byDateDesc)
        .slice(0, maxItems)
        .map((item) => ({ ...item, relevance: scorer.score(item, at) }))

      return { data: items, warnings }
    },
  })
}
