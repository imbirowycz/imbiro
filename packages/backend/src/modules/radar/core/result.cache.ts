import type { ModuleResult } from '@myorg/shared'

// Short-lived, per-process memory cache of module results. Nothing is persisted:
// a restart (deploy) simply starts with an empty cache.
//
// Stale-if-error: the last successful result of every module is kept for a few hours.
// When a source fails, that result is served instead of an error — marked `stale`, with a
// warning saying since when — so a short outage (e.g. Open-Meteo 503) does not empty the screen.

interface Entry {
  result: ModuleResult
  storedAt: number
  expiresAt: number
}

export interface ResultCacheOptions {
  now?: () => number
  /** Failed results are kept briefly so a broken source is not hammered by every request. */
  errorTtlMs?: number
  /** A forced refresh within this window returns the cached result instead of hitting the source. */
  minForceIntervalMs?: number
  /** How old the last good result may be to stand in for a failure (0 disables stale-if-error). */
  staleMaxAgeMs?: number
  /** Time zone for the "data from HH:MM" warning. */
  timeZone?: string
}

export class ResultCache {
  private readonly entries = new Map<string, Entry>()
  /** Last successful (or partial) result per module — the stale-if-error fallback. */
  private readonly lastGood = new Map<string, { result: ModuleResult; storedAt: number }>()
  /** Single-flight: concurrent requests for the same module share one in-flight load. */
  private readonly inFlight = new Map<string, Promise<ModuleResult>>()
  private readonly now: () => number
  private readonly errorTtlMs: number
  private readonly minForceIntervalMs: number
  private readonly staleMaxAgeMs: number
  private readonly timeZone: string

  constructor(options: ResultCacheOptions = {}) {
    this.now = options.now ?? Date.now
    this.errorTtlMs = options.errorTtlMs ?? 30_000
    this.minForceIntervalMs = options.minForceIntervalMs ?? 60_000
    this.staleMaxAgeMs = options.staleMaxAgeMs ?? 6 * 3600_000
    this.timeZone = options.timeZone ?? 'Europe/Warsaw'
  }

  /** Returns a fresh cached result, or the result of `load()` (shared with concurrent callers). */
  async getOrLoad(key: string, ttlMs: number, load: () => Promise<ModuleResult>, force = false): Promise<ModuleResult> {
    const entry = this.entries.get(key)
    const now = this.now()
    if (entry) {
      const fresh = entry.expiresAt > now
      const recentlyFetched = now - entry.storedAt < this.minForceIntervalMs
      if ((fresh && !force) || (force && recentlyFetched)) return { ...entry.result, cached: true }
    }

    const pending = this.inFlight.get(key)
    if (pending) return pending

    const promise = load()
      .then((loaded) => {
        // A cancelled run says nothing about the source — do not remember it.
        if (loaded.error?.code === 'CANCELLED') return loaded
        const storedAt = this.now()
        if (loaded.status !== 'error') {
          this.lastGood.set(key, { result: loaded, storedAt })
          this.entries.set(key, { result: loaded, storedAt, expiresAt: storedAt + ttlMs })
          return loaded
        }
        const result = this.staleFallback(key, loaded) ?? loaded
        // Errors (also when covered by stale data) are kept only briefly: the source is retried soon.
        this.entries.set(key, { result, storedAt, expiresAt: storedAt + Math.min(ttlMs, this.errorTtlMs) })
        return result
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, promise)
    return promise
  }

  /** Cached result regardless of age (used by the dashboard to render instantly). */
  peek(key: string): ModuleResult | null {
    const entry = this.entries.get(key)
    return entry ? { ...entry.result, cached: true } : null
  }

  clear(): void {
    this.entries.clear()
    this.lastGood.clear()
  }

  /** Last good data instead of an error, if recent enough. Status `partial`: data is there, but not current. */
  private staleFallback(key: string, failed: ModuleResult): ModuleResult | null {
    const good = this.lastGood.get(key)
    if (!good || this.staleMaxAgeMs <= 0 || this.now() - good.storedAt > this.staleMaxAgeMs) return null
    const since = new Date(good.result.fetchedAt).toLocaleTimeString('pl-PL', {
      timeZone: this.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    })
    const reason = failed.error?.message ?? 'błąd źródła'
    return {
      ...good.result,
      status: 'partial',
      cached: true,
      stale: true,
      durationMs: failed.durationMs,
      warnings: [`${failed.source.name} nie odpowiada (${reason}). Pokazuję dane z ${since}.`, ...good.result.warnings],
      error: null,
    }
  }
}
