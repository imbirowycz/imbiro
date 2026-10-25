import nodemailer, { type Transporter } from 'nodemailer'
import { z } from 'zod'
import { config } from '../../../config'
import { parseWith } from './action.registry'
import { ActionConfigurationError, NonRetryableActionError, type ActionHandler } from './action.types'

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

type SmtpSettings = NonNullable<typeof config.integrations.smtp>

export function createEmailSendAction(
  getSettings: () => SmtpSettings | null = () => config.integrations.smtp,
  createTransport: (settings: SmtpSettings) => Transporter = smtpTransport
): ActionHandler<EmailSendConfig> {
  let transport: Transporter | null = null

  return {
    type: 'email.send',
    description: 'Wysyła email przez SMTP',
    validateConfig: (raw) => parseWith(configSchema, raw),

    async execute(context, mail) {
      const settings = getSettings()
      if (!settings) {
        throw new ActionConfigurationError('email.send is not configured: set SMTP_HOST (and SMTP_FROM, SMTP_USER, SMTP_PASSWORD)')
      }
      if (!settings.from) {
        throw new ActionConfigurationError('email.send is not configured: set SMTP_FROM')
      }
      transport ??= createTransport(settings)

      try {
        const info = await transport.sendMail({
          from: settings.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          // Ten sam Message-ID dla wszystkich prób tego terminu ułatwia odbiorcom deduplikację.
          messageId: `<${context.executionId}@imbiro.scheduler>`,
        })
        const rejected = (info.rejected ?? []).map(String)
        if (rejected.length === mail.to.length) {
          throw new NonRetryableActionError(`All recipients rejected: ${rejected.join(', ')}`)
        }
        return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String), rejected }
      } catch (err) {
        // 5xx z serwera SMTP = trwałe odrzucenie; pozostałe (sieć, 4xx) mogą się udać przy ponowieniu.
        const responseCode = (err as { responseCode?: number }).responseCode
        if (responseCode && responseCode >= 500) {
          throw new NonRetryableActionError(`SMTP rejected the message (${responseCode}): ${(err as Error).message}`)
        }
        throw err
      }
    },
  }
}

function smtpTransport(settings: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  })
}
