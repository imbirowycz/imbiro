import { timingSafeEqual } from 'node:crypto'
import type { CookieOptions, NextFunction, Request, Response } from 'express'
import { config } from '../../core/config'
import { ForbiddenError, UnauthorizedError } from '../../core/errors'
import type { AuthSession, SessionRepository } from './session.repository'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Active administrator session (set by loadSession). */
      auth?: AuthSession
      /** Token from the cookie — needed only for logout. */
      sessionToken?: string
    }
  }
}

// The __Host- prefix (only with Secure): the browser accepts the cookie over HTTPS only,
// without a Domain attribute and with Path=/ — a subdomain cannot overwrite it.
export const SESSION_COOKIE = config.session.cookieSecure ? '__Host-imbiro_session' : 'imbiro_session'

export function sessionCookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
  }
}

/** Minimal Cookie header parser (no extra dependency). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** Loads the session from the cookie and checks it in the database on every request. Does not require login. */
export function loadSession(sessions: SessionRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE)
    if (!token) return next()
    try {
      const session = await sessions.findActive(token)
      if (session) {
        req.auth = session
        req.sessionToken = token
      } else {
        // Expired or revoked — remove the dead cookie from the browser.
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/** Requires an active administrator session (checked in the database by loadSession). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(new UnauthorizedError())
  next()
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const CSRF_HEADER = 'x-csrf-token'

/**
 * CSRF protection (synchronizer token): state-changing requests must send, in a header,
 * the token bound to the session. A foreign site does not know the token, and a custom header
 * is not sent cross-origin without CORS consent. SameSite=Lax is an extra layer, not the only one.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next()
  // Without a session there is nothing to protect — requireAuth (or the handler) answers 401.
  if (!req.auth) return next()

  const provided = Buffer.from(req.get(CSRF_HEADER) ?? '')
  const expected = Buffer.from(req.auth.csrfToken)
  const valid = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (!valid) return next(new ForbiddenError('Invalid or missing CSRF token'))
  next()
}

/** API responses with data must not end up in the browser cache or in intermediaries. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

/**
 * Second layer of CSRF protection: a state-changing request with an Origin header must come
 * from the application's own address or from an allowed frontend. Requests without Origin
 * (e.g. curl) pass through — the CSRF token protects them.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next()
  const origin = req.get('origin')
  if (!origin) return next()

  const ownOrigin = `${req.protocol}://${req.get('host')}`
  if (origin === ownOrigin || config.http.allowedOrigins.includes(origin)) return next()
  next(new ForbiddenError('Origin not allowed'))
}
