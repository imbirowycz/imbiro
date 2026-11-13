import { Router } from 'express'
import { z } from 'zod'
import { alertReadKey, newsReadKey, READ_KEY_MAX_LENGTH, type RunTarget } from '@myorg/shared'
import { NotFoundError, TooManyRequestsError, ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import { parseOrThrow } from '../../validation'
import type { ModuleRegistry } from './core/module.registry'
import { MAX_MODULES_PER_RUN, type ModuleRunner } from './core/module.runner'
import { buildDashboardSections, dashboardSnapshot } from './radar.dashboard'
import { canonicalUrl } from './parsing/news.normalize'
import { alertMarkExpiry, newsMarkExpiry, type ReadItemsStore, type ReadMark } from './read-items.repository'
import { ReaderBusyError, type ArticleReader } from './reader/article-reader'

type IdParams = { id: string }

const runOptionsSchema = z.strictObject({ force: z.boolean().default(false) })
const readQuerySchema = z.object({ url: z.string().trim().min(8).max(2000) })
const markLabel = { title: z.string().trim().max(300).nullish(), source: z.string().trim().max(120).nullish() }
const markReadSchema = z.discriminatedUnion('kind', [
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
const unmarkQuerySchema = z.object({ key: readKeySchema })
/** A whole dashboard section at most: 20 modules × 30 items, plus alerts. */
const MAX_MARKS_PER_REQUEST = 1000
const markManySchema = z.strictObject({ items: z.array(markReadSchema).min(1).max(MAX_MARKS_PER_REQUEST) })
const unmarkManySchema = z.strictObject({ keys: z.array(readKeySchema).min(1).max(MAX_MARKS_PER_REQUEST) })

/** Same canonical form as NewsItem.url, so a mark always matches the item it came from. */
function articleUrl(raw: string): string {
  const url = canonicalUrl(raw)
  if (!url) throw new ValidationError('Invalid request', [{ path: 'url', message: 'Not an http(s) URL' }])
  return url
}

const runManySchema = z.strictObject({
  moduleIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_MODULES_PER_RUN),
  force: z.boolean().default(false),
})

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return parseOrThrow(schema, body ?? {}, 'Invalid request')
}

/** Key and expiry of a mark — computed here with the same shared functions the frontend uses to hide items. */
function toReadMark(body: z.infer<typeof markReadSchema>, now: Date): ReadMark {
  const mark =
    body.kind === 'news'
      ? { key: newsReadKey(articleUrl(body.url)), expiresAt: newsMarkExpiry(now) }
      : { key: alertReadKey({ id: body.id, issuedAt: body.issuedAt ?? null, validFrom: body.validFrom ?? null }), expiresAt: alertMarkExpiry(body.expiresAt, now) }
  if (mark.key.length > READ_KEY_MAX_LENGTH) throw new ValidationError('Invalid request', [{ path: '(root)', message: 'Key too long' }])
  return { ...mark, title: body.title, source: body.source }
}

export interface RadarRouterDeps {
  registry: ModuleRegistry
  runner: ModuleRunner
  reader: ArticleReader
  readItems: ReadItemsStore
}

/**
 * Personal Radar API. Mounted under /api/radar, so it is behind session auth and CSRF like
 * the rest of /api. Module results are computed on demand (with an in-memory cache) and never stored.
 * A module failure is a normal 200 response with status "error" — it is data, not an API error.
 */
export function createRadarRouter({ registry, runner, reader, readItems }: RadarRouterDeps): Router {
  const router = Router()
  // Resolved once: groups are static, and a broken layout should fail at startup.
  const dashboardSections = buildDashboardSections(registry)

  // Instant: layout + cached results only. Sections are then refreshed via POST /run.
  router.get(
    '/dashboard',
    asyncHandler(async (_req, res) => {
      res.json(dashboardSnapshot(dashboardSections, runner, reader.domains, await readItems.listKeys()))
    })
  )

  // "Read" marks for news and alerts: the dashboard hides them and the morning digest skips them.
  // The key is computed here with the same shared function the frontend uses to hide items.
  router.post(
    '/read-items',
    asyncHandler(async (req, res) => {
      await readItems.markRead(toReadMark(parseBody(markReadSchema, req.body), new Date()))
      res.status(204).end()
    })
  )

  // "Mark the whole section as read": every item in one request; returns the keys (for "Undo").
  router.post(
    '/read-items/batch',
    asyncHandler(async (req, res) => {
      const { items } = parseBody(markManySchema, req.body)
      const now = new Date()
      const marks = items.map((item) => toReadMark(item, now))
      await readItems.markManyRead(marks)
      res.json({ keys: marks.map((m) => m.key) })
    })
  )

  // Undo of the above. POST, because a DELETE with a body is poorly supported.
  router.post(
    '/read-items/batch-delete',
    asyncHandler(async (req, res) => {
      const { keys } = parseBody(unmarkManySchema, req.body)
      await readItems.unmarkManyRead(keys)
      res.status(204).end()
    })
  )

  router.delete(
    '/read-items',
    asyncHandler(async (req, res) => {
      const { key } = parseBody(unmarkQuerySchema, req.query)
      await readItems.unmarkRead(key)
      res.status(204).end()
    })
  )

  // Reader mode on demand. GET is fine: it changes nothing (CSRF protects state changes),
  // and the result is not stored anywhere except a short in-memory cache.
  router.get(
    '/articles/read',
    asyncHandler(async (req, res) => {
      const { url } = parseBody(readQuerySchema, req.query)
      try {
        res.json(await reader.read(url))
      } catch (err) {
        if (err instanceof ReaderBusyError) throw new TooManyRequestsError('Czytnik jest zajęty, spróbuj za chwilę', 5)
        throw err
      }
    })
  )

  router.get('/modules', (_req, res) => {
    res.json(registry.listModules())
  })

  router.get('/groups', (_req, res) => {
    res.json(registry.listGroups())
  })

  router.post(
    '/modules/:id/run',
    asyncHandler<IdParams>(async (req, res) => {
      const { force } = parseBody(runOptionsSchema, req.body)
      if (!registry.has(req.params.id)) throw new NotFoundError(`Radar module ${req.params.id} not found`)
      res.json(await runner.runModule(req.params.id, { force }))
    })
  )

  router.post(
    '/groups/:id/run',
    asyncHandler<IdParams>(async (req, res) => {
      const { force } = parseBody(runOptionsSchema, req.body)
      if (!registry.hasGroup(req.params.id)) throw new NotFoundError(`Radar group ${req.params.id} not found`)
      res.json(await runner.run({ kind: 'group', id: req.params.id }, { force }))
    })
  )

  router.post(
    '/run',
    asyncHandler(async (req, res) => {
      const { moduleIds, force } = parseBody(runManySchema, req.body)
      const unknown = moduleIds.flatMap((id, index) => (registry.has(id) ? [] : [{ path: `moduleIds.${index}`, message: 'Unknown module' }]))
      if (unknown.length > 0) throw new ValidationError('Invalid request', unknown)
      const target: RunTarget = { kind: 'modules', ids: moduleIds }
      res.json(await runner.run(target, { force }))
    })
  )

  return router
}
