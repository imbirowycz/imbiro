import { z } from 'zod'
import { ValidationError } from '../../errors'

// Walidacja wejścia modułu „Łowca cen”. Definicja źródła pochodzi od AI, więc nieznane pola
// są pomijane (a nie odrzucane), za to wszystko, czego używa silnik, ma twarde limity.

const selector = z.string().trim().min(1).max(500)
const attr = z.string().trim().min(1).max(100).nullish()
const parseKind = z.enum(['pl-price', 'number', 'text'])

export const fieldSelectorSchema = z.object({ selector, attr, parse: parseKind.optional() })

export const availabilitySelectorSchema = z.object({
  selector,
  attr,
  inStockIf: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
})

export const fetchModeSchema = z.enum(['auto', 'http', 'browser'])

export const sourceDefinitionSchema = z
  .object({
    version: z.literal(1),
    source: z
      .object({ shop: z.string().trim().max(100).optional(), domain: z.string().trim().max(253).optional() })
      .optional(),
    fetch: z
      .object({
        mode: fetchModeSchema.optional(),
        waitFor: selector.optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .optional(),
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
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    notes: z.string().max(2000).optional(),
    promptVersion: z.number().int().positive().optional(),
  })
  .superRefine((def, ctx) => {
    if (def.strategy === 'css' && !def.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'Strategia "css" wymaga selektora ceny (price)' })
    }
  })

/** Odpowiedź AI, gdy definicji nie da się przygotować. */
export const definitionRefusalSchema = z.object({
  error: z.object({
    code: z.enum(['blocked', 'not_product_page', 'wrong_product', 'price_not_found', 'needs_js']),
    message: z.string().max(1000),
  }),
})

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }, 'Podaj pełny adres http(s)')

const telegramChatId = z
  .string()
  .trim()
  .regex(/^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/, 'Numeryczny chat id albo @kanał')

export const notifySchema = z
  .object({
    telegram: z.boolean(),
    telegramChatId: telegramChatId.nullish().or(z.literal('').transform(() => null)),
    email: z.boolean(),
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

export const saveSourceSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1, 'Podaj nazwę sklepu').max(100),
  url: httpUrl,
  fetchMode: fetchModeSchema.default('auto'),
  definition: sourceDefinitionSchema,
})

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
  notify: notifySchema,
  schedule: scheduleSchema,
  sources: z.array(saveSourceSchema).max(30, 'Najwyżej 30 źródeł'),
})

export const testSourceSchema = z.object({
  url: httpUrl,
  fetchMode: fetchModeSchema.default('auto'),
  definition: sourceDefinitionSchema.optional(),
})

export const snapshotSchema = z.object({ url: httpUrl, fetchMode: fetchModeSchema.default('auto') })

export const promptSchema = z.object({
  mode: z.enum(['new', 'repair']),
  url: httpUrl,
  shop: z.string().trim().max(100).optional(),
  fetchMode: fetchModeSchema.default('auto'),
  item: z.object({
    name: z.string().trim().min(1, 'Najpierw podaj nazwę artykułu').max(200),
    description: z.string().trim().max(2000).nullish(),
    ean: z.string().trim().max(14).nullish(),
  }),
  sourceId: z.uuid().optional(),
  currentDefinition: z.unknown().optional(),
})

export const notificationTestSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('telegram'), telegramChatId }),
  z.object({ channel: z.literal('email'), emailTo: z.email('Niepoprawny adres e-mail') }),
])

export type SaveItemInput = z.output<typeof saveItemSchema>
export type SaveSourceInput = z.output<typeof saveSourceSchema>
export type SourceDefinition = z.output<typeof sourceDefinitionSchema>

/** Walidacja z błędami w formacie API ({ path, message }). */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, message = 'Niepoprawne dane'): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ValidationError(
      message,
      result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') || '(root)', message: issue.message }))
    )
  }
  return result.data
}

/** JSON Schema definicji — wstawiany do promptu dla AI. */
export function definitionJsonSchema(): unknown {
  return z.toJSONSchema(sourceDefinitionSchema, { io: 'input', unrepresentable: 'any' })
}
