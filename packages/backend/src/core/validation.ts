import type { z } from 'zod'
import type { ApiErrorDetail } from '@myorg/shared'
import { ValidationError } from './errors'

/** Zod issues in the API error format: one `{ path, message }` per issue, paths joined with dots. */
export function zodIssuesToDetails(error: z.ZodError, rootPath = '(root)'): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || rootPath,
    message: issue.message,
  }))
}

/**
 * Parses `input` with a zod schema; on failure throws a ValidationError (HTTP 400) carrying
 * every issue. `rootPath` is the path reported for issues about the value as a whole.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string, rootPath = '(root)'): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new ValidationError(message, zodIssuesToDetails(result.error, rootPath))
  return result.data
}
