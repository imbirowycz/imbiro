import { timingSafeEqual } from 'node:crypto'
import type { CookieOptions, NextFunction, Request, Response } from 'express'
import { config } from '../../config'
import { ForbiddenError, UnauthorizedError } from '../../errors'
import { SessionRepository, type AuthSession } from './session.repository'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Aktywna sesja administratora (ustawiana przez loadSession). */
      auth?: AuthSession
      /** Token z cookie — potrzebny tylko przy wylogowaniu. */
      sessionToken?: string
    }
  }
}

// Prefiks __Host- (tylko przy Secure): przeglądarka przyjmie cookie wyłącznie z HTTPS,
// bez atrybutu Domain i z Path=/ — nie da się go nadpisać z subdomeny.
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

/** Minimalny parser nagłówka Cookie (bez dodatkowej zależności). */
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

/** Wczytuje sesję z cookie i sprawdza ją w bazie przy każdym żądaniu. Nie wymaga logowania. */
export function loadSession(sessions = new SessionRepository()) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE)
    if (!token) return next()
    try {
      const session = await sessions.findActive(token)
      if (session) {
        req.auth = session
        req.sessionToken = token
      } else {
        // Wygasła albo unieważniona — usuwamy martwe cookie z przeglądarki.
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions())
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/** Wymaga aktywnej sesji administratora (sprawdzonej w bazie przez loadSession). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(new UnauthorizedError())
  next()
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const CSRF_HEADER = 'x-csrf-token'

/**
 * Ochrona CSRF (synchronizer token): operacje zmieniające stan muszą przesłać w nagłówku
 * token powiązany z sesją. Obca strona nie zna tokenu, a niestandardowego nagłówka nie
 * wyśle cross-origin bez zgody CORS. SameSite=Lax jest dodatkową, nie jedyną warstwą.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next()
  // Bez sesji nie ma czego chronić — requireAuth (albo handler) zwróci 401.
  if (!req.auth) return next()

  const provided = Buffer.from(req.get(CSRF_HEADER) ?? '')
  const expected = Buffer.from(req.auth.csrfToken)
  const valid = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (!valid) return next(new ForbiddenError('Invalid or missing CSRF token'))
  next()
}

/** Odpowiedzi API z danymi nie mogą trafiać do cache przeglądarki ani pośredników. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  next()
}
