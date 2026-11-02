import type { ModuleResult, ModuleStatus, RadarError, RunResult, RunTarget } from '@myorg/shared'
import { abortError, createHttpClient, type HttpClient } from '../http/safe-fetch'
import type { ModuleRegistry } from './module.registry'
import type { RadarModule } from './module.types'
import { ERROR_MESSAGES, RadarSourceError } from './radar.errors'
import { ResultCache } from './result.cache'

/** Upper bound of modules in one ad-hoc run (API and scheduler). */
export const MAX_MODULES_PER_RUN = 20

export interface ModuleRunnerOptions {
  /** How many modules of one run may execute at the same time. */
  concurrency?: number
  /** Per-module timeout unless the module sets its own. */
  defaultTimeoutMs?: number
  /** Max nesting of composite modules. */
  maxDepth?: number
  cache?: ResultCache
  httpFactory?: (allowedHosts: readonly string[]) => HttpClient
  now?: () => Date
}

export interface RunOptions {
  /** Cancels the whole run (e.g. worker shutdown, scheduler timeout). */
  signal?: AbortSignal
  /** Bypass the cache (still rate-limited by the cache's minForceInterval). */
  force?: boolean
}

/**
 * Executes modules and wraps their output into uniform ModuleResults.
 * Never throws because of a module: every failure becomes a result with status "error",
 * so one broken source cannot break a group, the dashboard or a scheduled delivery.
 * Throws only UnknownTargetError for ids that are not registered (caller's mistake).
 */
export class ModuleRunner {
  private readonly concurrency: number
  private readonly defaultTimeoutMs: number
  private readonly maxDepth: number
  private readonly cache: ResultCache
  private readonly httpFactory: (allowedHosts: readonly string[]) => HttpClient
  private readonly now: () => Date

  constructor(
    private readonly registry: ModuleRegistry,
    options: ModuleRunnerOptions = {}
  ) {
    this.concurrency = options.concurrency ?? 4
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000
    this.maxDepth = options.maxDepth ?? 2
    this.cache = options.cache ?? new ResultCache()
    this.httpFactory = options.httpFactory ?? ((allowedHosts) => createHttpClient({ allowedHosts }))
    this.now = options.now ?? (() => new Date())
  }

  async runModule(id: string, options: RunOptions = {}): Promise<ModuleResult> {
    const module = this.registry.get(id)
    return this.runCached(module, options, 0)
  }

  async run(target: RunTarget, options: RunOptions = {}): Promise<RunResult> {
    return this.runTarget(target, options, 0)
  }

  /** Last cached result of a module (any age) without running it. */
  peek(id: string): ModuleResult | null {
    this.registry.get(id)
    return this.cache.peek(id)
  }

  private async runTarget(target: RunTarget, options: RunOptions, depth: number): Promise<RunResult> {
    const ids = this.registry.resolve(target)
    const startedAt = this.now()
    const started = performance.now()

    const settled = await mapWithLimit(ids, this.concurrency, (id) =>
      this.runCached(this.registry.get(id), options, depth)
    )
    // runCached does not reject, but a bug must still not break the whole run.
    const results = settled.map((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : this.failedResult(this.registry.get(ids[index]), startedAt, 0, internalError(outcome.reason))
    )

    return {
      target,
      status: aggregateStatus(results.map((result) => result.status)),
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      results,
    }
  }

  private runCached(module: RadarModule<unknown>, options: RunOptions, depth: number): Promise<ModuleResult> {
    return this.cache.getOrLoad(
      module.id,
      module.cacheTtlSeconds * 1000,
      () => this.execute(module, options, depth),
      options.force
    )
  }

  private async execute(module: RadarModule<unknown>, options: RunOptions, depth: number): Promise<ModuleResult> {
    const fetchedAt = this.now()
    const started = performance.now()
    const timeoutMs = module.timeoutMs ?? this.defaultTimeoutMs
    // Own timer instead of AbortSignal.timeout(): it can be cleared as soon as the module finishes.
    const timeout = new AbortController()
    const timer = setTimeout(
      () => timeout.abort(new DOMException(`Module timed out after ${timeoutMs} ms`, 'TimeoutError')),
      timeoutMs
    )
    const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
    const elapsed = () => Math.round(performance.now() - started)

    try {
      const output = await raceAbort(
        module.execute({
          signal,
          http: this.httpFactory(module.allowedHosts),
          log: (message) => console.log(`[radar ${module.id}] ${message}`),
          now: this.now,
          run: (target) => {
            if (depth + 1 > this.maxDepth) {
              return Promise.reject(
                new RadarSourceError('INTERNAL', 'Przekroczono dopuszczalne zagnieżdżenie modułów zbiorczych')
              )
            }
            return this.runTarget(target, { signal, force: options.force }, depth + 1)
          },
        }),
        signal
      )

      // Validate every item; one malformed entry must not discard the rest.
      const warnings = [...(output.warnings ?? [])]
      const data: unknown[] = []
      let invalid = 0
      for (const item of output.data) {
        const parsed = module.itemSchema.safeParse(item)
        if (parsed.success) data.push(parsed.data)
        else invalid++
      }
      if (invalid > 0) {
        warnings.push(`Pominięto ${invalid} niepoprawnych elementów`)
        console.warn(`[radar ${module.id}] dropped ${invalid} invalid item(s)`)
      }
      if (invalid > 0 && data.length === 0) {
        return this.failedResult(module, fetchedAt, elapsed(), { code: 'INVALID_RESPONSE', message: ERROR_MESSAGES.INVALID_RESPONSE }, warnings)
      }

      return {
        ...this.baseResult(module, fetchedAt, elapsed()),
        // A module with a fallback reports where the data really came from.
        ...(output.source ? { source: output.source } : {}),
        status: warnings.length > 0 ? 'partial' : 'success',
        dataAsOf: output.dataAsOf ?? null,
        data,
        warnings,
        error: null,
      }
    } catch (err) {
      const error = toRadarError(err, signal)
      if (error.code === 'INTERNAL') console.error(`[radar ${module.id}] unexpected failure`, err)
      else console.warn(`[radar ${module.id}] ${error.code}: ${error.message}`)
      return this.failedResult(module, fetchedAt, elapsed(), error)
    } finally {
      clearTimeout(timer)
    }
  }

  private baseResult(module: RadarModule<unknown>, fetchedAt: Date, durationMs: number) {
    return {
      moduleId: module.id,
      group: module.group,
      itemKind: module.itemKind,
      source: module.source,
      fetchedAt: fetchedAt.toISOString(),
      durationMs,
      cached: false,
      stale: false,
    }
  }

  private failedResult(
    module: RadarModule<unknown>,
    fetchedAt: Date,
    durationMs: number,
    error: RadarError,
    warnings: string[] = []
  ): ModuleResult {
    return {
      ...this.baseResult(module, fetchedAt, durationMs),
      status: 'error',
      dataAsOf: null,
      data: [],
      warnings,
      error,
    }
  }
}

export function aggregateStatus(statuses: ModuleStatus[]): ModuleStatus {
  if (statuses.every((status) => status === 'success')) return 'success'
  if (statuses.every((status) => status === 'error')) return 'error'
  return 'partial'
}

/**
 * Like Promise.allSettled, but at most `limit` tasks run at once —
 * we never fire requests to all sources simultaneously.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return results
}

/** Stops waiting when the signal aborts, even if a module ignores its signal. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort!))
}

function toRadarError(err: unknown, signal: AbortSignal): RadarError {
  if (err instanceof RadarSourceError) return { code: err.code, message: err.message }
  if (signal.aborted) {
    const aborted = abortError(signal)
    return { code: aborted.code, message: aborted.message }
  }
  return internalError(err)
}

function internalError(_err: unknown): RadarError {
  // Details stay in the server log; the client gets a generic message.
  return { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL }
}
