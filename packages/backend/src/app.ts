import cors from 'cors'
import express from 'express'
import { errorHandler, notFoundHandler } from './http'
import { createAuthRouter } from './modules/auth/auth.controller'
import { loadSession } from './modules/auth/auth.middleware'
import { createSchedulerRouter } from './modules/scheduler/scheduler.controller'
import type { SchedulerService } from './modules/scheduler/scheduler.service'

export function createApp(scheduler: SchedulerService): express.Express {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use(loadSession())
  app.use('/api/auth', createAuthRouter())
  app.use('/api/scheduler', createSchedulerRouter(scheduler))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
