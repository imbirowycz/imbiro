import { Router } from 'express'
import { z } from 'zod'
import type { RunTarget } from '@myorg/shared'
import { NotFoundError, ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import type { ModuleRegistry } from './core/module.registry'
import { MAX_MODULES_PER_RUN, type ModuleRunner } from './core/module.runner'
import { radarRegistry, radarRunner } from './radar.catalog'

type IdParams = { id: string }

const runOptionsSchema = z.strictObject({ force: z.boolean().default(false) })
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
export function createRadarRouter(registry: ModuleRegistry = radarRegistry, runner: ModuleRunner = radarRunner): Router {
  const router = Router()

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
