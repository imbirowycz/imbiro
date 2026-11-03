import { z } from 'zod'
import type { NewsItem } from '@myorg/shared'

const httpUrl = z.url({ protocol: /^https?$/ })

/** Validation of every normalized news item (the runner drops items that fail it). */
export const newsItemSchema: z.ZodType<NewsItem> = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(300),
  summary: z.string().max(500).nullable(),
  url: httpUrl,
  source: z.string().min(1),
  category: z.enum(['poland', 'world', 'warsaw', 'economy', 'it', 'ai', 'security', 'health']),
  publishedAt: z.iso.datetime().nullable(),
  author: z.string().max(120).nullable(),
  relevance: z.object({ score: z.number().int().min(0), matches: z.array(z.string()) }),
})
