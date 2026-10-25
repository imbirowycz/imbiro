import cors from 'cors'
import express from 'express'
import { config } from './config'
import { errorHandler, notFoundHandler } from './http'
import { createAuthRouter } from './modules/auth/auth.controller'
import { csrfProtection, loadSession, noStore, originCheck, requireAuth } from './modules/auth/auth.middleware'
import { createSchedulerRouter } from './modules/scheduler/scheduler.controller'
import type { SchedulerService } from './modules/scheduler/scheduler.service'

export function createApp(scheduler: SchedulerService): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.http.trustProxy || false)

  // CORS tylko dla wskazanych originów frontendu; bez listy przeglądarka nie dostanie zgody
  // na żądania z innych stron (na produkcji frontend i API są pod tym samym adresem).
  app.use(
    cors({
      origin: config.http.allowedOrigins.length ? config.http.allowedOrigins : false,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    })
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', noStore, originCheck, loadSession())
  // Publiczne są tylko logowanie i sprawdzenie sesji.
  app.use('/api/auth', createAuthRouter())
  // Wszystko inne pod /api wymaga sesji — także przyszłe moduły i nieistniejące ścieżki (401, nie 404).
  app.use('/api', requireAuth, csrfProtection)
  app.use('/api/scheduler', createSchedulerRouter(scheduler))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
