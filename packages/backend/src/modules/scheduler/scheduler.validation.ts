import { z } from 'zod'
import { ValidationError } from '../../errors'
import { isValidTimeZone, validateCronExpression, type ScheduleDefinition } from './schedule'

// Format zgodny z CHECK w bazie, np. "email.send".
const ACTION_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

const MAX_INTERVAL_SECONDS = 366 * 24 * 3600

const isoDate = z.iso
  .datetime({ offset: true, message: 'Must be an ISO 8601 date-time with timezone offset' })
  .transform((value) => new Date(value))

const baseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((value) => value || null),
  enabled: z.boolean().default(true),
  actionType: z.string().regex(ACTION_TYPE_RE, 'Must look like "group.name", e.g. "email.send"'),
  actionConfig: z.record(z.string(), z.unknown()).default({}),
  startAt: isoDate,
  endAt: isoDate.nullish().transform((value) => value ?? null),
  timezone: z
    .string()
    .default('UTC')
    .refine(isValidTimeZone, 'Unknown IANA time zone'),
})

const scheduleSchema = z.discriminatedUnion('scheduleType', [
  z.object({
    scheduleType: z.literal('once'),
    scheduleConfig: z.strictObject({}).default({}),
  }),
  z.object({
    scheduleType: z.literal('cron'),
    scheduleConfig: z.strictObject({ expression: z.string().trim().min(1) }),
  }),
  z.object({
    scheduleType: z.literal('interval'),
    scheduleConfig: z.strictObject({
      everySeconds: z.number().int().min(60).max(MAX_INTERVAL_SECONDS),
    }),
  }),
])

const taskDefinitionSchema = baseSchema.and(scheduleSchema).superRefine((value, ctx) => {
  if (value.endAt && value.endAt.getTime() <= value.startAt.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'endAt must be later than startAt' })
  }
  if (value.scheduleType === 'cron') {
    const error = validateCronExpression(value.scheduleConfig.expression, value.timezone)
    if (error) ctx.addIssue({ code: 'custom', path: ['scheduleConfig', 'expression'], message: error })
  }
})

export type TaskDefinition = z.output<typeof taskDefinitionSchema> & ScheduleDefinition

/** Pola, które klient może zmieniać przez PATCH. */
export const EDITABLE_FIELDS = [
  'title',
  'description',
  'enabled',
  'actionType',
  'actionConfig',
  'scheduleType',
  'scheduleConfig',
  'startAt',
  'endAt',
  'timezone',
] as const

export function parseTaskDefinition(input: unknown): TaskDefinition {
  const result = taskDefinitionSchema.safeParse(input)
  if (!result.success) {
    throw new ValidationError(
      'Invalid task definition',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      }))
    )
  }
  return result.data as TaskDefinition
}

/** Odrzuca nieznane pola i nie-obiekty, zanim body zostanie scalone z istniejącym zadaniem. */
export function assertPatchShape(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  const unknownKeys = Object.keys(input).filter(
    (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key)
  )
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      'Unknown fields',
      unknownKeys.map((key) => ({ path: key, message: 'Field cannot be set' }))
    )
  }
  return input as Record<string, unknown>
}
