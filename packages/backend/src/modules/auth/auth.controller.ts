import { Router, type Request } from 'express'
import { z } from 'zod'
import type { AuthSessionInfo } from '@myorg/shared'
import { config } from '../../config'
import { TooManyRequestsError, UnauthorizedError, ValidationError } from '../../errors'
import { asyncHandler } from '../../http'
import { SESSION_COOKIE, sessionCookieOptions } from './auth.middleware'
import { LoginLimiter } from './login-limiter'
import { normalizeLogin, verifyAdminCredentials } from './password'
import { SessionRepository, type AuthSession } from './session.repository'

const loginSchema = z.object({
  login: z.string().trim().min(1).max(200),
  // Górny limit chroni przed kosztownym hashowaniem ogromnych danych.
  password: z.string().min(1).max(1024),
})

// Jeden komunikat dla złego loginu i złego hasła — nie zdradzamy, które się nie zgadza.
const INVALID_CREDENTIALS = 'Invalid login or password'

function sessionInfo(session: AuthSession): AuthSessionInfo {
  const admin = config.admin
  return {
    user: { username: admin.username, email: admin.email },
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt.toISOString(),
  }
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

export function createAuthRouter(sessions = new SessionRepository(), limiter = new LoginLimiter()): Router {
  const router = Router()

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body)
      if (!parsed.success) throw new ValidationError('Login and password are required')

      const ip = clientIp(req)
      const identifier = normalizeLogin(parsed.data.login)

      const decision = await limiter.check(ip, identifier)
      if (!decision.allowed) {
        console.warn(`Auth: login blocked by rate limit (ip ${ip}, retry after ${decision.retryAfterSeconds}s)`)
        throw new TooManyRequestsError('Too many login attempts. Try again later.', decision.retryAfterSeconds)
      }

      const user = await verifyAdminCredentials(parsed.data.login, parsed.data.password)
      await limiter.record(ip, identifier, user !== null)
      if (!user) {
        // Bez loginu w logu — ludzie czasem wpisują tam hasło.
        console.warn(`Auth: failed login (ip ${ip})`)
        throw new UnauthorizedError(INVALID_CREDENTIALS)
      }

      // Zawsze nowa sesja (ochrona przed session fixation); poprzednia z tej przeglądarki jest usuwana.
      if (req.sessionToken) await sessions.deleteByToken(req.sessionToken)
      const { token, session } = await sessions.create({ ip, userAgent: req.get('user-agent') ?? null })
      void sessions.deleteExpired().catch(() => {})
      void limiter.deleteOld().catch(() => {})

      console.log(`Auth: admin logged in (ip ${ip})`)
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt))
      res.json(sessionInfo(session))
    })
  )

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      if (req.sessionToken) await sessions.deleteByToken(req.sessionToken)
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
      res.status(204).end()
    })
  )

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.auth) throw new UnauthorizedError()
      res.json(sessionInfo(req.auth))
    })
  )

  return router
}
