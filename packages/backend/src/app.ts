import cors from 'cors'
import express, { type Router } from 'express'
import { config } from './core/config'
import { errorHandler, notFoundHandler } from './core/http'
import {
  createAuthRouter,
  csrfProtection,
  loadSession,
  noStore,
  originCheck,
  requireAuth,
  type LoginLimiter,
  type SessionRepository,
} from './modules/auth'
import { createRadarRouter, type RadarRouterDeps } from './modules/radar'
import { createSchedulerRouter, type ActionRegistry, type SchedulerService } from './modules/scheduler'

/** Everything the HTTP layer talks to. Built in composition.ts (tests pass fakes). */
export interface AppDeps {
  sessions: SessionRepository
  loginLimiter: LoginLimiter
  scheduler: SchedulerService
  actions: ActionRegistry
  radar: RadarRouterDeps
  /** Okazje: the admin API (behind the session). */
  prices: Router
  /** Okazje: the API of the home collector (its own token instead of the session). */
  collector: Router
}

export function createApp({ sessions, loginLimiter, scheduler, actions, radar, prices, collector }: AppDeps): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.http.trustProxy || false)

  // CORS only for the listed frontend origins; without the list the browser gets no permission
  // for requests from other sites (in production the frontend and the API share one address).
  app.use(
    cors({
      origin: config.http.allowedOrigins.length ? config.http.allowedOrigins : false,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    })
  )
  // The collector sends whole shop pages (gzip is inflated by express.json), hence its own body
  // limit — and it is mounted before the session/CSRF chain, because it is not a browser.
  app.use('/api/collector', noStore, express.json({ limit: '8mb' }), collector)
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', noStore, originCheck, loadSession(sessions))
  // Only login and the session check are public.
  app.use('/api/auth', createAuthRouter(sessions, loginLimiter))
  // Everything else under /api needs a session — future modules and unknown paths too (401, not 404).
  app.use('/api', requireAuth, csrfProtection)
  app.use('/api/scheduler', createSchedulerRouter(scheduler, actions))
  app.use('/api/radar', createRadarRouter(radar))
  app.use('/api/prices', prices)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
