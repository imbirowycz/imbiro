import { Router } from 'express'
import { z } from 'zod'
import type { RunTarget } from '@myorg/shared'
import { NotFoundError, TooManyRequestsError, ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import type { ModuleRegistry } from './core/module.registry'
import { MAX_MODULES_PER_RUN, type ModuleRunner } from './core/module.runner'
import { radarRegistry, radarRunner } from './radar.catalog'
import { radarConfig } from './radar.config'
import { buildDashboardSections, dashboardSnapshot } from './radar.dashboard'
import { canonicalUrl } from './parsing/news.normalize'
import { createReadItemsRepository, type ReadItemsStore } from './read-items.repository'
import { ArticleReader, ReaderBusyError } from './reader/article-reader'

type IdParams = { id: string }

const runOptionsSchema = z.strictObject({ force: z.boolean().default(false) })
const readQuerySchema = z.object({ url: z.string().trim().min(8).max(2000) })
const markReadSchema = z.strictObject({
  url: z.string().trim().min(8).max(2000),
  title: z.string().trim().max(300).nullish(),
  source: z.string().trim().max(120).nullish(),
})

/** Same canonical form as NewsItem.url, so a mark always matches the item it came from. */
function articleUrl(raw: string): string {
  const url = canonicalUrl(raw)
  if (!url) throw new ValidationError('Invalid request', [{ path: 'url', message: 'Not an http(s) URL' }])
  return url
}

/** Reader instance of the API process (the Worker never reads articles). */
const defaultReader = () => new ArticleReader({ allowedDomains: radarConfig.reader.allowedDomains })

const runManySchema = z.strictObject({
  moduleIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_MODULES_PER_RUN),
  force: z.boolean().default(false),
})

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    throw new ValidationError(
      'Invalid request',
      result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') || '(root)', message: issue.message }))
    )
  }
  return result.data
}

/**
 * Personal Radar API. Mounted under /api/radar, so it is behind session auth and CSRF like
 * the rest of /api. Module results are computed on demand (with an in-memory cache) and never stored.
 * A module failure is a normal 200 response with status "error" — it is data, not an API error.
 */
export function createRadarRouter(
  registry: ModuleRegistry = radarRegistry,
  runner: ModuleRunner = radarRunner,
  reader: ArticleReader = defaultReader(),
  readItems: ReadItemsStore = createReadItemsRepository()
): Router {
  const router = Router()
  // Resolved once: groups are static, and a broken layout should fail at startup.
  const dashboardSections = buildDashboardSections(registry)

  // Instant: layout + cached results only. Sections are then refreshed via POST /run.
  router.get(
    '/dashboard',
    asyncHandler(async (_req, res) => {
      res.json(dashboardSnapshot(dashboardSections, runner, reader.domains, await readItems.listUrls()))
    })
  )

  // "Read" marks: the dashboard hides these news and the morning digest skips them.
  router.post(
    '/read-items',
    asyncHandler(async (req, res) => {
      const body = parseBody(markReadSchema, req.body)
      await readItems.markRead({ url: articleUrl(body.url), title: body.title, source: body.source })
      res.status(204).end()
    })
  )

  router.delete(
    '/read-items',
    asyncHandler(async (req, res) => {
      const { url } = parseBody(readQuerySchema, req.query)
      await readItems.unmarkRead(articleUrl(url))
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
