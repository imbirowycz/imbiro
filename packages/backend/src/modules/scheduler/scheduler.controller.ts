import { Router } from 'express'
import { ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import { actionRegistry, type ActionRegistry } from './actions'
import type { SchedulerService } from './scheduler.service'

type TaskParams = { id: string }

const DEFAULT_EXECUTIONS_LIMIT = 50
const MAX_EXECUTIONS_LIMIT = 200

export function createSchedulerRouter(service: SchedulerService, actions: ActionRegistry = actionRegistry): Router {
  const router = Router()

  // Dostępne typy akcji — dla formularza na froncie.
  router.get('/actions', (_req, res) => {
    res.json(actions.list())
  })

  router.get(
    '/tasks',
    asyncHandler(async (_req, res) => {
      res.json(await service.list())
    })
  )

  router.post(
    '/tasks',
    asyncHandler(async (req, res) => {
      const task = await service.create(req.body)
      res.status(201).location(`${req.baseUrl}/tasks/${task.id}`).json(task)
    })
  )

  router.get(
    '/tasks/:id',
    asyncHandler<TaskParams>(async (req, res) => {
      res.json(await service.get(req.params.id))
    })
  )

  router.patch(
    '/tasks/:id',
    asyncHandler<TaskParams>(async (req, res) => {
      res.json(await service.update(req.params.id, req.body))
    })
  )

  router.post(
    '/tasks/:id/enable',
    asyncHandler<TaskParams>(async (req, res) => {
      res.json(await service.enable(req.params.id))
    })
  )

  router.post(
    '/tasks/:id/disable',
    asyncHandler<TaskParams>(async (req, res) => {
      res.json(await service.disable(req.params.id))
    })
  )

  // 202: wykonanie jest w kolejce; jego stan widać w historii wykonań.
  router.post(
    '/tasks/:id/run',
    asyncHandler<TaskParams>(async (req, res) => {
      const execution = await service.runNow(req.params.id)
      res.status(202).location(`${req.baseUrl}/tasks/${req.params.id}/executions`).json(execution)
    })
  )

  router.get(
    '/tasks/:id/executions',
    asyncHandler<TaskParams>(async (req, res) => {
      res.json(await service.listExecutions(req.params.id, parseLimit(req.query.limit)))
    })
  )

  return router
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_EXECUTIONS_LIMIT
  const limit = Number(raw)
  if (typeof raw !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > MAX_EXECUTIONS_LIMIT) {
    throw new ValidationError('Invalid query', [
      { path: 'limit', message: `Must be an integer between 1 and ${MAX_EXECUTIONS_LIMIT}` },
    ])
  }
  return limit
}
