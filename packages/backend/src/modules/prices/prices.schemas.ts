import { z } from 'zod'
import { parseOrThrow } from '../../core/validation'

// Input validation of the prices module. Unknown fields of a source definition are dropped
// (older definitions carry extra ones); everything the engine uses has hard limits.

const selector = z.string().trim().min(1).max(500)
const attr = z.string().trim().min(1).max(100).nullish()
const parseKind = z.enum(['pl-price', 'number', 'text'])

export const fieldSelectorSchema = z.object({ selector, attr, parse: parseKind.optional() })

export const availabilitySelectorSchema = z.object({
  selector,
  attr,
  inStockIf: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
})

export const sourceDefinitionSchema = z
  .object({
    version: z.literal(1),
    fetch: z.object({ waitFor: selector.optional() }).optional(),
    strategy: z.enum(['auto', 'css']),
    price: fieldSelectorSchema.optional(),
    oldPrice: fieldSelectorSchema.optional(),
    title: fieldSelectorSchema.optional(),
    availability: availabilitySelectorSchema.optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Kod waluty ISO 4217, np. PLN')
      .optional(),
    expected: z
      .object({
        title: z.string().trim().max(500).optional(),
        price: z.number().nonnegative().optional(),
        oldPrice: z.number().nonnegative().nullish(),
        available: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((def, ctx) => {
    if (def.strategy === 'css' && !def.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Strategia "css" wymaga selektora ceny (price)' })
    }
  })

// The collector opens only https pages (and refuses private networks on its side).
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Podaj pełny adres https://')

const telegramChatId = z
  .string()
  .trim()
  .regex(/^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/, 'Numeryczny chat id albo @kanał')

export const notifySchema = z
  .object({
    telegram: z.boolean().default(false),
    telegramChatId: telegramChatId.nullish().or(z.literal('').transform(() => null)),
    email: z.boolean().default(false),
    emailTo: z.email('Niepoprawny adres e-mail').nullish().or(z.literal('').transform(() => null)),
  })
  .superRefine((value, ctx) => {
    if (value.telegram && !value.telegramChatId) {
      ctx.addIssue({ code: 'custom', path: ['telegramChatId'], message: 'Podaj chat id, żeby włączyć Telegram' })
    }
    if (value.email && !value.emailTo) {
      ctx.addIssue({ code: 'custom', path: ['emailTo'], message: 'Podaj adres e-mail, żeby włączyć e-mail' })
    }
  })
  .transform((value) => ({
    telegram: value.telegram,
    telegramChatId: value.telegramChatId ?? null,
    email: value.email,
    emailTo: value.emailTo ?? null,
  }))

export const scheduleSchema = z
  .object({
    kind: z.enum(['cron', 'interval']),
    cron: z.string().trim().max(100).optional(),
    everyHours: z.number().int().min(1).max(24 * 7).optional(),
    jitterMinutes: z.number().int().min(0).max(240).default(60),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'cron' && !value.cron) ctx.addIssue({ code: 'custom', path: ['cron'], message: 'Podaj wyrażenie cron' })
    if (value.kind === 'interval' && !value.everyHours) {
      ctx.addIssue({ code: 'custom', path: ['everyHours'], message: 'Podaj co ile godzin' })
    }
  })

const AUTO_DEFINITION = { version: 1 as const, strategy: 'auto' as const }

export const newSourceSchema = z.object({
  label: z.string().trim().min(1, 'Podaj nazwę sklepu').max(100),
  url: httpsUrl,
  enabled: z.boolean().default(true),
  definition: sourceDefinitionSchema.default(AUTO_DEFINITION),
})

export const saveSourceSchema = newSourceSchema.extend({ id: z.uuid().optional() })

export const saveItemSchema = z.object({
  name: z.string().trim().min(1, 'Podaj nazwę artykułu').max(200),
  description: z.string().trim().max(2000).nullish().transform((v) => v || null),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'EAN to 8–14 cyfr')
    .nullish()
    .or(z.literal('').transform(() => null))
    .transform((v) => v || null),
  targetPrice: z.number().positive().max(10_000_000).nullish().transform((v) => v ?? null),
  minDropPct: z.number().min(0).max(90).default(5),
  enabled: z.boolean().default(true),
  notify: notifySchema.default({ telegram: false, telegramChatId: null, email: false, emailTo: null }),
  schedule: scheduleSchema,
  sources: z.array(saveSourceSchema).max(30, 'Najwyżej 30 źródeł'),
})

export const notificationTestSchema = z.object({ telegramChatId })

export const collectorClaimSchema = z.object({ hostname: z.string().trim().max(100).optional() })

export const collectorResultSchema = z.object({
  jobId: z.uuid(),
  ok: z.boolean(),
  httpStatus: z.number().int().min(0).max(999).nullable(),
  finalUrl: z.string().max(4000).nullable(),
  html: z.string().nullable(),
  durationMs: z.number().int().min(0).max(3_600_000),
  error: z
    .object({
      code: z.enum(['BLOCKED', 'BLOCKED_URL', 'HTTP_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'TOO_LARGE']),
      message: z.string().max(500),
    })
    .optional(),
})

export type SaveItemInput = z.output<typeof saveItemSchema>
export type SaveSourceInput = z.output<typeof saveSourceSchema>
export type CollectorResultInput = z.output<typeof collectorResultSchema>
export type SourceDefinition = z.output<typeof sourceDefinitionSchema>

/** Validation with errors in the API format ({ path, message }). */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, message = 'Niepoprawne dane'): T {
  return parseOrThrow(schema, input, message)
}
