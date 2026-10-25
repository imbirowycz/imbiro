import type { ApiError, ApiErrorDetail } from '@myorg/shared'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

/** Błąd z API z listą błędów pól (path → message). */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetail[] = [],
    readonly retryAfterSeconds?: number
  ) {
    super(message)
  }
}

// Token CSRF z /api/auth/login albo /me — tylko w pamięci, nie w localStorage.
let csrfToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

/** Wywoływane przy każdej odpowiedzi 401 (sesja wygasła albo została unieważniona). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

const SAFE_METHODS = new Set(['GET', 'HEAD'])

export async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (!SAFE_METHODS.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken

  let res: Response
  try {
    res = await fetch(`${apiBase}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Cookie sesji także przy API pod innym originem (lokalny Docker).
      credentials: 'include',
    })
  } catch {
    throw new ApiRequestError('Brak połączenia z serwerem. Sprawdź, czy backend działa.', 0)
  }

  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const error = data as ApiError | null
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.()
    // Nieaktualny token CSRF (np. logowanie w innej karcie): pobierz bieżący i ponów raz.
    if (res.status === 403 && error?.error === 'Invalid or missing CSRF token' && !retried) {
      const session = await request<{ csrfToken: string }>('GET', '/auth/me').catch(() => null)
      if (session) {
        csrfToken = session.csrfToken
        return request<T>(method, path, body, true)
      }
    }
    throw new ApiRequestError(error?.error ?? `Błąd serwera (${res.status})`, res.status, error?.details, retryAfter)
  }
  return data as T
}
