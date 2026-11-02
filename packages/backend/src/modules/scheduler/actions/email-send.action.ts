import type { Transporter } from 'nodemailer'
import { z } from 'zod'
import { config } from '../../../config'
import { parseWith } from './action.registry'
import type { ActionHandler } from './action.types'
import { EmailSender, type SmtpSettings } from './delivery/email.client'

const configSchema = z
  .strictObject({
    to: z.union([z.email(), z.array(z.email()).min(1).max(50)]),
    subject: z.string().trim().min(1).max(500),
    text: z.string().max(100_000).optional(),
    html: z.string().max(500_000).optional(),
  })
  .refine((value) => value.text || value.html, { path: ['text'], message: 'Provide text or html' })
  .transform((value) => ({ ...value, to: Array.isArray(value.to) ? value.to : [value.to] }))

export type EmailSendConfig = z.output<typeof configSchema>

export function createEmailSendAction(
  getSettings: () => SmtpSettings | null = () => config.integrations.smtp,
  createTransport?: (settings: SmtpSettings) => Transporter
): ActionHandler<EmailSendConfig> {
  const sender = new EmailSender(getSettings, createTransport)

  return {
    type: 'email.send',
    description: 'Wysyła email przez SMTP',
    validateConfig: (raw) => parseWith(configSchema, raw),

    // The same Message-ID for every attempt of this slot lets recipients deduplicate.
    async execute(context, mail) {
      return { ...(await sender.send(mail, `<${context.executionId}@imbiro.scheduler>`)) }
    },
  }
}
