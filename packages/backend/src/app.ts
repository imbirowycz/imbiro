import cors from 'cors'
import express from 'express'
import { errorHandler, notFoundHandler } from './http'
import { createAuthRouter } from './modules/auth/auth.controller'
import { csrfProtection, loadSession, noStore, requireAuth } from './modules/auth/auth.middleware'
import { createSchedulerRouter } from './modules/scheduler/scheduler.controller'
import type { SchedulerService } from './modules/scheduler/scheduler.service'

export function createApp(scheduler: SchedulerService): express.Express {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', noStore, loadSession())
  // Publiczne są tylko logowanie i sprawdzenie sesji.
  app.use('/api/auth', createAuthRouter())
  // Wszystko inne pod /api wymaga sesji — także przyszłe moduły i nieistniejące ścieżki (401, nie 404).
  app.use('/api', requireAuth, csrfProtection)
  app.use('/api/scheduler', createSchedulerRouter(scheduler))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
