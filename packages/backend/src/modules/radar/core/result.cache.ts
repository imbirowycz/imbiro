import type { ModuleResult } from '@myorg/shared'

// Short-lived, per-process memory cache of module results. Nothing is persisted:
// a restart (deploy) simply starts with an empty cache.

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
}

export class ResultCache {
  private readonly entries = new Map<string, Entry>()
  /** Single-flight: concurrent requests for the same module share one in-flight load. */
  private readonly inFlight = new Map<string, Promise<ModuleResult>>()
  private readonly now: () => number
  private readonly errorTtlMs: number
  private readonly minForceIntervalMs: number

  constructor(options: ResultCacheOptions = {}) {
    this.now = options.now ?? Date.now
    this.errorTtlMs = options.errorTtlMs ?? 30_000
    this.minForceIntervalMs = options.minForceIntervalMs ?? 60_000
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
      .then((result) => {
        // A cancelled run says nothing about the source — do not remember it.
        if (result.error?.code === 'CANCELLED') return result
        const ttl = result.status === 'error' ? Math.min(ttlMs, this.errorTtlMs) : ttlMs
        this.entries.set(key, { result, storedAt: this.now(), expiresAt: this.now() + ttl })
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
  }
}
