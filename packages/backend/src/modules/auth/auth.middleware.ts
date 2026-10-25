import type { CookieOptions, NextFunction, Request, Response } from 'express'
import { config } from '../../config'
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
