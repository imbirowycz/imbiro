import { Router } from 'express'
import { AppError } from '../../core/errors'
import { asyncHandler } from '../../core/http'
import type { PriceNotifier } from './price-notify'
import { notificationTestSchema, parseInput } from './prices.schemas'
import type { PricesService } from './prices.service'

type IdParams = { id: string }

export function createPricesRouter(service: PricesService, notifier: PriceNotifier): Router {
  const router = Router()

  router.get(
    '/overview',
    asyncHandler(async (_req, res) => {
      res.json(await service.overview())
    })
  )

  // A test message from the form — checks the chat id before saving.
  router.post(
    '/notifications/test',
    asyncHandler(async (req, res) => {
      const { telegramChatId } = parseInput(notificationTestSchema, req.body)
      try {
        await notifier.sendTest(telegramChatId)
      } catch (err) {
        throw new AppError(`Nie udało się wysłać: ${(err as Error).message}`, 502)
      }
      res.json({ ok: true })
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
    '/items/:id/changes',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.changes(req.params.id))
    })
  )

  // Single sources, managed from the item popup. Each returns the updated item.
  router.post(
    '/items/:id/sources',
    asyncHandler<IdParams>(async (req, res) => {
      res.status(201).json(await service.addSource(req.params.id, req.body))
    })
  )

  router.post(
    '/sources/:id/enable',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.setSourceEnabled(req.params.id, true))
    })
  )

  router.post(
    '/sources/:id/disable',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.setSourceEnabled(req.params.id, false))
    })
  )

  router.post(
    '/sources/:id/check-now',
    asyncHandler<IdParams>(async (req, res) => {
      res.status(202).json(await service.checkSource(req.params.id))
    })
  )

  router.delete(
    '/sources/:id',
    asyncHandler<IdParams>(async (req, res) => {
      res.json(await service.deleteSource(req.params.id))
    })
  )

  return router
}
