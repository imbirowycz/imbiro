import type { ExecutionTrigger } from '@myorg/shared'

/** Information about the current execution passed to the action handler. */
export interface ActionContext {
  taskId: string
  taskTitle: string
  /**
   * Id of the task_executions record — the same for every attempt of one run.
   * A handler may use it as an idempotency key on the external service's side.
   */
  executionId: string
  scheduledFor: Date
  trigger: ExecutionTrigger
  /** Attempt number, starting at 1. */
  attempt: number
  /** Aborted on timeout or worker shutdown; the handler should pass it to its I/O. */
  signal: AbortSignal
  log: (message: string) => void
}

/** Result stored in task_executions.result (must be JSON-serializable). */
export type ActionResult = Record<string, unknown> | null

export interface ActionHandler<TConfig = unknown> {
  /** Registry key, stored as scheduled_tasks.action_type, e.g. "email.send". */
  readonly type: string
  readonly description: string
  /**
   * Validates a config from the database/API and returns it in normalized form.
   * Throws ValidationError. Does not check integrations (env) — that is a runtime error, not a data error.
   */
  validateConfig(config: unknown): TConfig
  execute(context: ActionContext, config: TConfig): Promise<ActionResult>
}

/**
 * An error that retrying cannot fix (e.g. missing integration configuration, rejected recipient).
 * The worker then ends the execution right away as failed, with no further attempts.
 */
export class NonRetryableActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** The integration an action needs is not configured in the environment. */
export class ActionConfigurationError extends NonRetryableActionError {}
