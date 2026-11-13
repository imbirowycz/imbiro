import { Router } from 'express'
import type { RunTarget } from '@myorg/shared'
import { NotFoundError, TooManyRequestsError, ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import type { ModuleRegistry } from './core/module.registry'
import type { ModuleRunner } from './core/module.runner'
import { buildDashboardSections, dashboardSnapshot } from './radar.dashboard'
import {
  markManySchema,
  markReadSchema,
  parseRequest,
  readQuerySchema,
  runManySchema,
  runOptionsSchema,
  toReadMark,
  unmarkManySchema,
  unmarkQuerySchema,
} from './radar.schemas'
import type { ReadItemsRepository } from './read-items.repository'
import { ReaderBusyError, type ArticleReader } from './reader/article-reader'

type IdParams = { id: string }

export interface RadarRouterDeps {
  registry: ModuleRegistry
  runner: ModuleRunner
  reader: ArticleReader
  readItems: ReadItemsRepository
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
      await readItems.markRead(toReadMark(parseRequest(markReadSchema, req.body), new Date()))
      res.status(204).end()
    })
  )

  // "Mark the whole section as read": every item in one request; returns the keys (for "Undo").
  router.post(
    '/read-items/batch',
    asyncHandler(async (req, res) => {
      const { items } = parseRequest(markManySchema, req.body)
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
      const { keys } = parseRequest(unmarkManySchema, req.body)
      await readItems.unmarkManyRead(keys)
      res.status(204).end()
    })
  )

  router.delete(
    '/read-items',
    asyncHandler(async (req, res) => {
      const { key } = parseRequest(unmarkQuerySchema, req.query)
      await readItems.unmarkRead(key)
      res.status(204).end()
    })
  )

  // Reader mode on demand. GET is fine: it changes nothing (CSRF protects state changes),
  // and the result is not stored anywhere except a short in-memory cache.
  router.get(
    '/articles/read',
    asyncHandler(async (req, res) => {
      const { url } = parseRequest(readQuerySchema, req.query)
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
      const { force } = parseRequest(runOptionsSchema, req.body)
      if (!registry.has(req.params.id)) throw new NotFoundError(`Radar module ${req.params.id} not found`)
      res.json(await runner.runModule(req.params.id, { force }))
    })
  )

  router.post(
    '/groups/:id/run',
    asyncHandler<IdParams>(async (req, res) => {
      const { force } = parseRequest(runOptionsSchema, req.body)
      if (!registry.hasGroup(req.params.id)) throw new NotFoundError(`Radar group ${req.params.id} not found`)
      res.json(await runner.run({ kind: 'group', id: req.params.id }, { force }))
    })
  )

  router.post(
    '/run',
    asyncHandler(async (req, res) => {
      const { moduleIds, force } = parseRequest(runManySchema, req.body)
      const unknown = moduleIds.flatMap((id, index) => (registry.has(id) ? [] : [{ path: `moduleIds.${index}`, message: 'Unknown module' }]))
      if (unknown.length > 0) throw new ValidationError('Invalid request', unknown)
      const target: RunTarget = { kind: 'modules', ids: moduleIds }
      res.json(await runner.run(target, { force }))
    })
  )

  return router
}
