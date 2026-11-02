import type { RadarErrorCode } from '@myorg/shared'

/**
 * Expected failure of a radar source (timeout, HTTP error, bad payload…).
 * `message` must be safe to show to the user: no URLs with secrets, no stack traces.
 */
export class RadarSourceError extends Error {
  constructor(
    readonly code: RadarErrorCode,
    message: string,
    /** Whether repeating the request may help (network, 5xx, 429). */
    readonly retryable = false,
    /** Server-provided delay before the next attempt (429 Retry-After). */
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** Default user-facing messages per code. */
export const ERROR_MESSAGES: Record<RadarErrorCode, string> = {
  TIMEOUT: 'Źródło nie odpowiedziało na czas',
  CANCELLED: 'Pobieranie zostało przerwane',
  NETWORK_ERROR: 'Brak połączenia ze źródłem',
  HTTP_ERROR: 'Źródło zwróciło błąd',
  RATE_LIMITED: 'Źródło chwilowo ogranicza liczbę zapytań',
  TOO_LARGE: 'Odpowiedź źródła jest zbyt duża',
  BLOCKED_URL: 'Adres nie jest dozwolony',
  INVALID_RESPONSE: 'Źródło zwróciło nieoczekiwane dane',
  PARSE_ERROR: 'Nie udało się odczytać odpowiedzi źródła',
  INTERNAL: 'Nieoczekiwany błąd modułu',
}
