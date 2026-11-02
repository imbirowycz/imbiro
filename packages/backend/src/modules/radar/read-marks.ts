// How long a "read" mark is kept (pure functions — no database, easy to test).

/** News are at most a few days old, so their marks can be forgotten after two weeks. */
export const NEWS_MARK_DAYS = 14
/** Alerts without an end date (e.g. transport notices). */
export const ALERT_MARK_DEFAULT_DAYS = 60
/** Alerts with an end date: kept one day longer, in case the source keeps it listed briefly. */
export const ALERT_MARK_GRACE_DAYS = 1
/** Upper bound for an alert-provided end date (protects against nonsense dates). */
export const ALERT_MARK_MAX_DAYS = 400

const DAY_MS = 86_400_000

export function newsMarkExpiry(now: Date): Date {
  return new Date(now.getTime() + NEWS_MARK_DAYS * DAY_MS)
}

/** Until the alert ends (+ grace), or a default when it has no end; clamped to a sane range. */
export function alertMarkExpiry(alertExpiresAt: string | null | undefined, now: Date): Date {
  const end = alertExpiresAt ? Date.parse(alertExpiresAt) : NaN
  const wanted = Number.isNaN(end) ? now.getTime() + ALERT_MARK_DEFAULT_DAYS * DAY_MS : end + ALERT_MARK_GRACE_DAYS * DAY_MS
  const min = now.getTime() + ALERT_MARK_GRACE_DAYS * DAY_MS
  const max = now.getTime() + ALERT_MARK_MAX_DAYS * DAY_MS
  return new Date(Math.min(max, Math.max(min, wanted)))
}
