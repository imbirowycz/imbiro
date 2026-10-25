import type { ExecutionTrigger } from '@myorg/shared'

/** Informacje o bieżącym wykonaniu przekazywane do handlera akcji. */
export interface ActionContext {
  taskId: string
  taskTitle: string
  /**
   * Id rekordu w task_executions — stały dla wszystkich prób tego samego terminu.
   * Handler może go użyć jako klucza idempotencji po stronie zewnętrznej usługi.
   */
  executionId: string
  scheduledFor: Date
  trigger: ExecutionTrigger
  /** Numer próby, od 1. */
  attempt: number
  /** Przerwany przy timeoucie albo zamykaniu workera; handler powinien go przekazywać do I/O. */
  signal: AbortSignal
  log: (message: string) => void
}

/** Wynik zapisywany w task_executions.result (musi dać się zserializować do JSON). */
export type ActionResult = Record<string, unknown> | null

export interface ActionHandler<TConfig = unknown> {
  /** Klucz w rejestrze, zapisywany jako scheduled_tasks.action_type, np. "email.send". */
  readonly type: string
  readonly description: string
  /**
   * Waliduje konfigurację z bazy/API i zwraca ją w znormalizowanej postaci.
   * Rzuca ValidationError. Nie sprawdza integracji (env) — to błąd wykonania, nie danych.
   */
  validateConfig(config: unknown): TConfig
  execute(context: ActionContext, config: TConfig): Promise<ActionResult>
}

/**
 * Błąd, którego ponowienie nie ma sensu (np. brak konfiguracji integracji, odrzucony adresat).
 * Worker kończy wtedy wykonanie od razu jako failed, bez kolejnych prób.
 */
export class NonRetryableActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Integracja potrzebna akcji nie jest skonfigurowana w środowisku. */
export class ActionConfigurationError extends NonRetryableActionError {}
