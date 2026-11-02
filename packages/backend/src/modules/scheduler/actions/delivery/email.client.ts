import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../../../../config'
import { ActionConfigurationError, NonRetryableActionError } from '../action.types'

// SMTP sender shared by `email.send` and `radar.deliver`.

export type SmtpSettings = NonNullable<typeof config.integrations.smtp>

export interface OutgoingMail {
  to: string[]
  subject: string
  text?: string
  html?: string
}

export interface SentMail {
  messageId: string
  accepted: string[]
  rejected: string[]
}

export class EmailSender {
  private transport: Transporter | null = null

  constructor(
    private readonly getSettings: () => SmtpSettings | null = () => config.integrations.smtp,
    private readonly createTransport: (settings: SmtpSettings) => Transporter = smtpTransport
  ) {}

  /** Throws ActionConfigurationError when SMTP is not configured — call before doing expensive work. */
  assertConfigured(): SmtpSettings & { from: string } {
    const settings = this.getSettings()
    if (!settings) {
      throw new ActionConfigurationError('email is not configured: set SMTP_HOST (and SMTP_FROM, SMTP_USER, SMTP_PASSWORD)')
    }
    if (!settings.from) throw new ActionConfigurationError('email is not configured: set SMTP_FROM')
    return settings as SmtpSettings & { from: string }
  }

  /** `messageId` should be stable for all attempts of one execution so recipients can deduplicate. */
  async send(mail: OutgoingMail, messageId: string): Promise<SentMail> {
    const settings = this.assertConfigured()
    this.transport ??= this.createTransport(settings)

    try {
      const info = await this.transport.sendMail({
        from: settings.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId,
      })
      const rejected = (info.rejected ?? []).map(String)
      if (rejected.length === mail.to.length) {
        throw new NonRetryableActionError(`All recipients rejected: ${rejected.join(', ')}`)
      }
      return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String), rejected }
    } catch (err) {
      // 5xx from the SMTP server = permanent rejection; others (network, 4xx) may succeed on retry.
      const responseCode = (err as { responseCode?: number }).responseCode
      if (responseCode && responseCode >= 500) {
        throw new NonRetryableActionError(`SMTP rejected the message (${responseCode}): ${(err as Error).message}`)
      }
      throw err
    }
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
