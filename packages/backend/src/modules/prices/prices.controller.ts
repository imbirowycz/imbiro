import { Router, type Response } from 'express'
import { asyncHandler } from '../../http'
import type { PriceTools } from './prices.tools'

/** Sygnał przerwany, gdy klient zamknie połączenie (np. zamknięty formularz). */
export function requestSignal(res: Response): AbortSignal {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller.signal
}

export function createPricesRouter(tools: PriceTools): Router {
  const router = Router()

  router.post(
    '/sources/test',
    asyncHandler(async (req, res) => {
      res.json(await tools.testSource(req.body, requestSignal(res)))
    })
  )

  router.post(
    '/sources/snapshot',
    asyncHandler(async (req, res) => {
      res.json(await tools.snapshot(req.body, requestSignal(res)))
    })
  )

  router.post(
    '/sources/prompt',
    asyncHandler(async (req, res) => {
      res.json(await tools.prompt(req.body, requestSignal(res)))
    })
  )

  return router
}
