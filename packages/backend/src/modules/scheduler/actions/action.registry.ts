import type { z } from 'zod'
import { ValidationError } from '../../../errors'
import { parseOrThrow } from '../../../validation'
import type { ActionHandler } from './action.types'

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler<any>>()

  register(handler: ActionHandler<any>): this {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Action "${handler.type}" is already registered`)
    }
    this.handlers.set(handler.type, handler)
    return this
  }

  has(type: string): boolean {
    return this.handlers.has(type)
  }

  get(type: string): ActionHandler<unknown> {
    const handler = this.handlers.get(type)
    if (!handler) throw new ValidationError(`Unknown action type "${type}"`)
    return handler
  }

  list(): { type: string; description: string }[] {
    return [...this.handlers.values()].map(({ type, description }) => ({ type, description }))
  }

  /** Config validation before a task is saved. Error paths are relative to `actionConfig`. */
  validateConfig(type: string, config: unknown): unknown {
    if (!this.has(type)) {
      throw new ValidationError('Invalid task definition', [
        { path: 'actionType', message: `Unknown action type; available: ${[...this.handlers.keys()].join(', ')}` },
      ])
    }
    try {
      return this.get(type).validateConfig(config)
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ValidationError(
          'Invalid task definition',
          (err.details ?? [{ path: '', message: err.message }]).map((detail) => ({
            path: ['actionConfig', detail.path].filter(Boolean).join('.'),
            message: detail.message,
          }))
        )
      }
      throw err
    }
  }
}

/** Helper for handlers: validation with a zod schema, errors in the API format. */
export function parseWith<T>(schema: z.ZodType<T>, config: unknown): T {
  // Empty root path: the registry adds the `actionConfig` prefix afterwards.
  return parseOrThrow(schema, config, 'Invalid action config', '')
}
