import { Router, type Request } from 'express'
import { z } from 'zod'
import type { AuthSessionInfo } from '@myorg/shared'
import { config } from '../../core/config'
import { TooManyRequestsError, UnauthorizedError, UnsupportedMediaTypeError, ValidationError } from '../../core/errors'
import { asyncHandler } from '../../core/http'
import { csrfProtection, SESSION_COOKIE, sessionCookieOptions } from './auth.middleware'
import type { LoginLimiter } from './login-limiter'
import { normalizeLogin, verifyAdminCredentials } from './password'
import type { AuthSession, SessionRepository } from './session.repository'

const loginSchema = z.object({
  login: z.string().trim().min(1).max(200),
  // The upper limit protects against expensive hashing of huge inputs.
  password: z.string().min(1).max(1024),
})

// One message for a wrong login and a wrong password — we do not reveal which one is wrong.
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

export function createAuthRouter(sessions: SessionRepository, limiter: LoginLimiter): Router {
  const router = Router()

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      // JSON only: a plain HTML form on a foreign site cannot send this content type.
      if (!req.is('application/json')) throw new UnsupportedMediaTypeError('Content-Type must be application/json')
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
        // No login in the log — people sometimes type their password there.
        console.warn(`Auth: failed login (ip ${ip})`)
        throw new UnauthorizedError(INVALID_CREDENTIALS)
      }

      // Always a new session (session fixation protection); the previous one from this browser is deleted.
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
    csrfProtection,
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
