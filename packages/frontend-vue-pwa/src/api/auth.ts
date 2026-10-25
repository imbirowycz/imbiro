import type { AuthSessionInfo, LoginDTO } from '@myorg/shared'
import { ApiRequestError, request, setCsrfToken } from './client'

export const authApi = {
  async login(dto: LoginDTO): Promise<AuthSessionInfo> {
    const session = await request<AuthSessionInfo>('POST', '/auth/login', dto)
    setCsrfToken(session.csrfToken)
    return session
  },

  /** Bieżąca sesja albo null, gdy nikt nie jest zalogowany. */
  async me(): Promise<AuthSessionInfo | null> {
    try {
      const session = await request<AuthSessionInfo>('GET', '/auth/me')
      setCsrfToken(session.csrfToken)
      return session
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setCsrfToken(null)
        return null
      }
      throw err
    }
  },

  async logout(): Promise<void> {
    try {
      await request<void>('POST', '/auth/logout')
    } finally {
      setCsrfToken(null)
    }
  },
}
