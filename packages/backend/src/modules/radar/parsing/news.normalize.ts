import { createHash } from 'node:crypto'
import type { NewsCategory, NewsItem } from '@myorg/shared'
import type { FeedEntry } from './feed.parser'
import { htmlToText, truncate } from './text'

// Raw feed entry → NewsItem (without relevance; that is computed later from config).

export type UnscoredNewsItem = Omit<NewsItem, 'relevance'>

export interface NormalizeOptions {
  source: string
  category: NewsCategory
  /** Base for relative links (feed URL or channel link). */
  baseUrl: string
  titlePrefix?: string
  summaryMaxLength?: number
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|at_medium|at_campaign|ocid|cmpid)$/i

/**
 * Canonical form of an article URL: http(s) only, no fragment, no tracking parameters.
 * Used both as the link we show and as a deduplication key. Returns null for unusable URLs.
 */
export function canonicalUrl(raw: string, base?: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim(), base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  url.hash = ''
  for (const [key, value] of [...url.searchParams.entries()]) {
    // `source=rss` (e.g. TVN24) only marks the feed; elsewhere `source` may be meaningful.
    if (TRACKING_PARAMS.test(key) || (key === 'source' && value === 'rss')) url.searchParams.delete(key)
  }
  return url.toString()
}

/** RFC 822 (RSS) and ISO 8601 (Atom) → ISO string; null when missing or invalid. */
export function parseDate(value: string | null): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Returns null for entries without a usable title or link. */
export function normalizeFeedEntry(entry: FeedEntry, options: NormalizeOptions): UnscoredNewsItem | null {
  const title = entry.title ? htmlToText(entry.title) : ''
  const url = entry.link ? canonicalUrl(entry.link, options.baseUrl) : null
  if (!title || !url) return null

  const summaryText = entry.summary ? htmlToText(entry.summary) : ''
  // Many feeds (e.g. RMF24) repeat the title as the description.
  const summary = summaryText && summaryText !== title ? truncate(summaryText, options.summaryMaxLength ?? 280) : null

  return {
    id: entry.id?.trim() || `url:${shortHash(url)}`,
    title: truncate(options.titlePrefix ? `${options.titlePrefix} ${title}` : title, 300),
    summary,
    url,
    source: options.source,
    category: options.category,
    publishedAt: parseDate(entry.published),
    author: entry.author ? truncate(htmlToText(entry.author), 120) || null : null,
  }
}

/** Newest first; entries without a date go last (stable order otherwise). */
export function byDateDesc(a: { publishedAt: string | null }, b: { publishedAt: string | null }): number {
  if (a.publishedAt === b.publishedAt) return 0
  if (!a.publishedAt) return 1
  if (!b.publishedAt) return -1
  return b.publishedAt.localeCompare(a.publishedAt)
}
