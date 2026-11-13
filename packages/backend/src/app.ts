import cors from 'cors'
import express from 'express'
import { config } from './config'
import { errorHandler, notFoundHandler } from './http'
import { createAuthRouter, csrfProtection, loadSession, noStore, originCheck, requireAuth } from './modules/auth'
import { createRadarRouter } from './modules/radar'
import { createSchedulerRouter, type ActionRegistry, type SchedulerService } from './modules/scheduler'

/** Optional replacements for the default collaborators (used by HTTP tests). */
export interface AppOverrides {
  sessions?: Parameters<typeof createAuthRouter>[0]
  loginLimiter?: Parameters<typeof createAuthRouter>[1]
  radar?: Parameters<typeof createRadarRouter>
}

export function createApp(scheduler: SchedulerService, actions: ActionRegistry, overrides: AppOverrides = {}): express.Express {
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

  app.use('/api', noStore, originCheck, loadSession(overrides.sessions))
  // Publiczne są tylko logowanie i sprawdzenie sesji.
  app.use('/api/auth', createAuthRouter(overrides.sessions, overrides.loginLimiter))
  // Wszystko inne pod /api wymaga sesji — także przyszłe moduły i nieistniejące ścieżki (401, nie 404).
  app.use('/api', requireAuth, csrfProtection)
  app.use('/api/scheduler', createSchedulerRouter(scheduler, actions))
  app.use('/api/radar', createRadarRouter(...(overrides.radar ?? [])))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
