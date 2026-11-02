import type { AlertItem } from './radar.model'

// Keys of items marked as read/hidden in Personal Radar. Used by the backend (storage, digest)
// and the frontend (hiding) — one definition, so both always compute the same key.

export const READ_KEY_MAX_LENGTH = 2100

/** News: the canonical article URL (the one radar modules put in NewsItem.url). */
export function newsReadKey(url: string): string {
  return `news:${url}`
}

/**
 * Alerts: id plus issue time — a re-issued (updated) warning gets a new key and shows up again,
 * because it carries new information.
 */
export function alertReadKey(alert: Pick<AlertItem, 'id' | 'issuedAt' | 'validFrom'>): string {
  return `alert:${alert.id}|${alert.issuedAt ?? alert.validFrom ?? ''}`
}
