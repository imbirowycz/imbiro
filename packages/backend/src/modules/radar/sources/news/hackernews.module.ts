import { z } from 'zod'
import type { NewsItem } from '@myorg/shared'
import { mapWithLimit } from '../../core/module.runner'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { canonicalUrl } from '../../parsing/news.normalize'
import type { NewsScorer } from '../../parsing/relevance'
import { htmlToText, truncate } from '../../parsing/text'
import { newsItemSchema } from './news.schema'

// Official HN API (Firebase): a list of ids, then one request per story.
// We fetch only the top N stories, at most 5 at a time, to stay polite.

const HN_HOST = 'hacker-news.firebaseio.com'
const HN_API = `https://${HN_HOST}/v0`
const ITEM_CONCURRENCY = 5

const idsSchema = z.array(z.number().int().positive())
const storySchema = z
  .object({
    id: z.number().int(),
    type: z.string(),
    title: z.string().optional(),
    url: z.string().optional(),
    by: z.string().optional(),
    time: z.number().int().optional(),
    score: z.number().int().optional(),
    descendants: z.number().int().optional(),
    dead: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  // Deleted items come back as `null`.
  .nullable()

export function createHackerNewsModule(scorer: NewsScorer, maxItems: number, list: 'top' | 'best' = 'top') {
  return defineModule<NewsItem>({
    id: list === 'top' ? 'news.hackernews' : 'news.hackernews.best',
    name: list === 'top' ? 'Hacker News' : 'Hacker News – najlepsze',
    group: 'news',
    category: 'it',
    description: `${maxItems} ${list === 'top' ? 'najwyżej notowanych' : 'najlepszych'} wątków z Hacker News`,
    source: { name: 'Hacker News', homepage: 'https://news.ycombinator.com' },
    itemKind: 'news',
    kind: 'collector',
    allowedHosts: [HN_HOST],
    itemSchema: newsItemSchema,
    cacheTtlSeconds: 15 * 60,
    timeoutMs: 25_000,

    async execute({ http, signal, now }) {
      const ids = await http.getJson(`${HN_API}/${list}stories.json`, idsSchema, { signal })
      const settled = await mapWithLimit(ids.slice(0, maxItems), ITEM_CONCURRENCY, (id) =>
        http.getJson(`${HN_API}/item/${id}.json`, storySchema, { signal, retries: 1 })
      )

      const failed = settled.filter((outcome) => outcome.status === 'rejected').length
      if (failed === settled.length && settled.length > 0) {
        const first = settled.find((outcome) => outcome.status === 'rejected')
        throw first?.reason instanceof RadarSourceError ? first.reason : new RadarSourceError('NETWORK_ERROR', 'Nie udało się pobrać wątków HN')
      }

      const at = now()
      const data: NewsItem[] = []
      for (const outcome of settled) {
        if (outcome.status !== 'fulfilled') continue
        const story = outcome.value
        if (!story || story.dead || story.deleted || story.type !== 'story' || !story.title) continue
        const discussion = `https://news.ycombinator.com/item?id=${story.id}`
        // Ask/Show HN without an external link point to the discussion.
        const url = (story.url && canonicalUrl(story.url)) || discussion
        const item = {
          id: String(story.id),
          title: truncate(htmlToText(story.title), 300),
          summary: `${story.score ?? 0} pkt · ${story.descendants ?? 0} komentarzy`,
          url,
          source: 'Hacker News',
          category: 'it' as const,
          publishedAt: story.time ? new Date(story.time * 1000).toISOString() : null,
          author: story.by ?? null,
        }
        if (!scorer.isExcluded(item)) data.push({ ...item, relevance: scorer.score(item, at) })
      }

      return { data, warnings: failed > 0 ? [`Nie udało się pobrać ${failed} z ${settled.length} wątków`] : [] }
    },
  })
}
