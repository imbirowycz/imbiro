import { z } from 'zod'
import { alertReadKey, newsReadKey, READ_KEY_MAX_LENGTH } from '@myorg/shared'
import { ValidationError } from '../../errors'
import { parseOrThrow } from '../../validation'
import { MAX_MODULES_PER_RUN } from './core/module.runner'
import { canonicalUrl } from './parsing/news.normalize'
import { alertMarkExpiry, newsMarkExpiry } from './read-marks'
import type { ReadMark } from './read-items.repository'

// Request schemas of the radar API and the conversion of a validated request into a "read" mark.
// The routes themselves are in radar.controller.ts.

export const runOptionsSchema = z.strictObject({ force: z.boolean().default(false) })

export const runManySchema = z.strictObject({
  moduleIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_MODULES_PER_RUN),
  force: z.boolean().default(false),
})

export const readQuerySchema = z.object({ url: z.string().trim().min(8).max(2000) })

const markLabel = { title: z.string().trim().max(300).nullish(), source: z.string().trim().max(120).nullish() }
export const markReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('news'), url: z.string().trim().min(8).max(2000), ...markLabel }),
  z.strictObject({
    kind: z.literal('alert'),
    id: z.string().min(1).max(1000),
    issuedAt: z.string().max(40).nullish(),
    validFrom: z.string().max(40).nullish(),
    expiresAt: z.string().max(40).nullish(),
    ...markLabel,
  }),
])

const readKeySchema = z.string().min(6).max(READ_KEY_MAX_LENGTH).regex(/^(news:https?:\/\/|alert:)/, 'Unknown key type')
export const unmarkQuerySchema = z.object({ key: readKeySchema })

/** A whole dashboard section at most: 20 modules × 30 items, plus alerts. */
const MAX_MARKS_PER_REQUEST = 1000
export const markManySchema = z.strictObject({ items: z.array(markReadSchema).min(1).max(MAX_MARKS_PER_REQUEST) })
export const unmarkManySchema = z.strictObject({ keys: z.array(readKeySchema).min(1).max(MAX_MARKS_PER_REQUEST) })

/** Validates a request body or query; a missing body counts as an empty object. */
export function parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  return parseOrThrow(schema, input ?? {}, 'Invalid request')
}

/** Same canonical form as NewsItem.url, so a mark always matches the item it came from. */
function articleUrl(raw: string): string {
  const url = canonicalUrl(raw)
  if (!url) throw new ValidationError('Invalid request', [{ path: 'url', message: 'Not an http(s) URL' }])
  return url
}

/** Key and expiry of a mark — computed here with the same shared functions the frontend uses to hide items. */
export function toReadMark(body: z.infer<typeof markReadSchema>, now: Date): ReadMark {
  const mark =
    body.kind === 'news'
      ? { key: newsReadKey(articleUrl(body.url)), expiresAt: newsMarkExpiry(now) }
      : { key: alertReadKey({ id: body.id, issuedAt: body.issuedAt ?? null, validFrom: body.validFrom ?? null }), expiresAt: alertMarkExpiry(body.expiresAt, now) }
  if (mark.key.length > READ_KEY_MAX_LENGTH) throw new ValidationError('Invalid request', [{ path: '(root)', message: 'Key too long' }])
  return { ...mark, title: body.title, source: body.source }
}
