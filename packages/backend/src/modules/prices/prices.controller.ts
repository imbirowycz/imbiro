import { Router, type Response } from 'express'
import { asyncHandler } from '../../http'
import { AppError } from '../../errors'
import type { PriceNotifier } from './price-notify'
import { notificationTestSchema, parseInput } from './prices.schemas'
import type { PricesService } from './prices.service'
import type { PriceTools } from './prices.tools'

type IdParams = { id: string }

/** Sygnał przerwany, gdy klient zamknie połączenie (np. zamknięty formularz). */
export function requestSignal(res: Response): AbortSignal {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller.signal
}

export function createPricesRouter(service: PricesService, tools: PriceTools, notifier: PriceNotifier): Router {
  const router = Router()

  // Wiadomość testowa z formularza — sprawdzenie adresu e-mail / chat id przed zapisem.
  router.post(
    '/notifications/test',
    asyncHandler(async (req, res) => {
      const target = parseInput(notificationTestSchema, req.body)
      try {
        await notifier.sendTest(target)
      } catch (err) {
        throw new AppError(`Nie udało się wysłać: ${(err as Error).message}`, 502)
      }
      res.json({ ok: true })
    })
  )

  router.get(
    '/items',
    asyncHandler(async (req, res) => {
      const { q, status, enabled } = req.query
      res.json(
        await service.list({
          q: typeof q === 'string' ? q : undefined,
          status: status === 'problem' || status === 'ok' ? status : undefined,
          enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
        })
      )
    })
  )

  router.post(
    '/items',
    asyncHandler(async (req, res) => {
      const item = await service.create(req.body)
      res.status(201).location(`${req.baseUrl}/items/${item.id}`).json(item)
    })
  )

  router.get(
    '/items/:id',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.get(req.params.id))
    })
  )

  router.put(
    '/items/:id',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.update(req.params.id, req.body))
    })
  )

  router.delete(
    '/items/:id',
    asyncHandler<IdParams>(async (req, res) => {
      await service.delete(req.params.id)
      res.status(204).end()
    })
  )

  router.post(
    '/items/:id/enable',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.setEnabled(req.params.id, true))
    })
  )

  router.post(
    '/items/:id/disable',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.setEnabled(req.params.id, false))
    })
  )

  router.post(
    '/items/:id/check-now',
    asyncHandler<IdParams>(async (req, res) => {
      res.status(202).json(await service.checkNow(req.params.id))
    })
  )

  router.get(
    '/sources/:id/history',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.history(req.params.id))
    })
  )

  router.get(
    '/sources/:id/snapshot',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.lastSnapshot(req.params.id))
    })
  )

  router.get(
    '/offers',
    asyncHandler(async (req, res) => {
      res.json(await service.listOffers(req.query as Record<string, unknown>))
    })
  )

  router.get(
    '/offers/unread-count',
    asyncHandler(async (_req, res) => {
      res.json(await service.unreadCount())
    })
  )

  router.post(
    '/offers/read',
    asyncHandler(async (req, res) => {
      res.json(await service.markRead(req.body))
    })
  )

  router.post(
    '/offers/dismiss',
    asyncHandler(async (req, res) => {
      res.json(await service.dismiss(req.body))
    })
  )

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
