import { timingSafeEqual } from 'node:crypto'
import { Router, type RequestHandler } from 'express'
import type { CollectorClaimResponse, CollectorSettings } from '@myorg/shared'
import { UnauthorizedError } from '../../core/errors'
import { asyncHandler } from '../../core/http'
import type { PriceCheckProcessor } from './price-check.processor'
import type { PriceQueue } from './price-queue'
import type { PricesRepository } from './prices.repository'
import { collectorClaimSchema, collectorResultSchema, parseInput } from './prices.schemas'

// The API of the home collector: it asks what to fetch and reports the pages back.
// Authorized with a shared secret instead of the administrator session (the collector is a
// program, not a browser). The server decides everything: which pages, how many, how often.

export interface CollectorRouterDeps {
  /** Unset = nobody is authorized. */
  token: string | undefined
  settings: CollectorSettings
  queue: PriceQueue
  repo: PricesRepository
  processor: PriceCheckProcessor
}

export function requireCollectorToken(token: string | undefined): RequestHandler {
  const expected = token ? Buffer.from(token) : null
  return (req, _res, next) => {
    const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    if (!expected || given.length !== expected.length || !timingSafeEqual(given, expected)) return next(new UnauthorizedError())
    next()
  }
}

export function createCollectorRouter({ token, settings, queue, repo, processor }: CollectorRouterDeps): Router {
  const router = Router()
  router.use(requireCollectorToken(token))

  router.post(
    '/claim',
    asyncHandler(async (req, res) => {
      const { hostname } = parseInput(collectorClaimSchema, req.body ?? {})
      await repo.touchCollector(hostname ?? null)

      const response: CollectorClaimResponse = { settings, jobs: [] }
      for (const job of await queue.claim(settings.maxJobsPerClaim)) {
        const source = await repo.findSource(job.data.sourceId)
        // A source deleted or switched off while its check waited: nothing to fetch.
        if (!source || !source.enabled) {
          await queue.complete(job.id, { skipped: source ? 'source disabled' : 'source no longer exists' })
          continue
        }
        response.jobs.push({ jobId: job.id, url: source.url, waitFor: source.definition.fetch?.waitFor })
      }
      res.json(response)
    })
  )

  router.post(
    '/results',
    asyncHandler(async (req, res) => {
      const result = parseInput(collectorResultSchema, req.body)
      const job = await queue.find(result.jobId)
      // Unknown, expired (and maybe re-queued) or already reported: the result is stale.
      if (!job || job.state !== 'active') {
        res.status(409).json({ error: 'Job is not active' })
        return
      }
      res.json(await processor.process(job, result))
    })
  )

  return router
}
