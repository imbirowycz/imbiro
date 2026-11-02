import type { z } from 'zod'
import type { RadarGroupId, RadarItemKind, RadarSourceInfo, RunResult, RunTarget } from '@myorg/shared'
import type { HttpClient } from '../http/safe-fetch'

/** Everything a module may use while running. Modules never touch the DB, scheduler or UI. */
export interface ModuleContext {
  /** Aborted on timeout or when the caller cancels; pass it to every I/O call. */
  signal: AbortSignal
  /** HTTP client restricted to the module's `allowedHosts`. */
  http: HttpClient
  log: (message: string) => void
  now: () => Date
  /** Composite modules only: runs other modules through the same runner (cache, limits, timeouts). */
  run: (target: RunTarget) => Promise<RunResult>
}

/** What a module returns. The runner wraps it into a uniform ModuleResult. */
export interface ModuleOutput<T> {
  data: T[]
  warnings?: string[]
  /** Real date of the data according to the source, if known. */
  dataAsOf?: string | null
}

export interface RadarModule<T = unknown> {
  /** Unique, dotted id, e.g. "finance.nbp.currencies". */
  readonly id: string
  readonly name: string
  readonly group: RadarGroupId
  readonly category?: string
  readonly description: string
  readonly source: RadarSourceInfo
  readonly itemKind: RadarItemKind | null
  readonly kind: 'collector' | 'composite'
  /** Hostnames the module may contact (exact match). */
  readonly allowedHosts: readonly string[]
  /** Every item is validated against this schema; invalid items are dropped with a warning. */
  readonly itemSchema: z.ZodType<T>
  readonly cacheTtlSeconds: number
  /** Overrides the runner's default per-module timeout. */
  readonly timeoutMs?: number
  /** Composite modules: ids of modules they may run (validated at startup). */
  readonly dependsOn?: readonly string[]
  execute(context: ModuleContext): Promise<ModuleOutput<T>>
}

/** Helper that keeps the item type inferred from the schema. */
export function defineModule<T>(module: RadarModule<T>): RadarModule<T> {
  return module
}
