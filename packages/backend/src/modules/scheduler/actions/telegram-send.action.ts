import { z } from 'zod'
import { config } from '../../../config'
import { parseWith } from './action.registry'
import { ActionConfigurationError, NonRetryableActionError, type ActionHandler } from './action.types'

const configSchema = z.strictObject({
  // Numeryczne id czatu (grupy są ujemne) albo @nazwa_kanału.
  chatId: z.union([
    z.number().int(),
    z.string().regex(/^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/, 'Must be a numeric chat id or @channel'),
  ]),
  text: z.string().trim().min(1).max(4096),
  parseMode: z.enum(['HTML', 'MarkdownV2']).optional(),
  disableNotification: z.boolean().optional(),
})

export type TelegramSendConfig = z.output<typeof configSchema>

interface TelegramResponse {
  ok: boolean
  result?: { message_id: number }
  error_code?: number
  description?: string
}

export function createTelegramSendAction(
  getToken: () => string | undefined = () => config.integrations.telegram.botToken,
  fetchImpl: typeof fetch = fetch
): ActionHandler<TelegramSendConfig> {
  return {
    type: 'telegram.send',
    description: 'Wysyła wiadomość przez Telegram Bot API',
    validateConfig: (raw) => parseWith(configSchema, raw),

    async execute(context, message) {
      const token = getToken()
      if (!token) {
        throw new ActionConfigurationError('telegram.send is not configured: set TELEGRAM_BOT_TOKEN')
      }

      let response: Response
      try {
        response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.chatId,
            text: message.text,
            parse_mode: message.parseMode,
            disable_notification: message.disableNotification,
          }),
          signal: context.signal,
        })
      } catch (err) {
        // Bez URL w komunikacie — zawiera token.
        throw new Error(`Telegram request failed: ${(err as Error).message}`)
      }

      const body = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse
      if (response.ok && body.ok && body.result) {
        return { messageId: body.result.message_id, chatId: message.chatId }
      }

      const description = `Telegram API error ${body.error_code ?? response.status}: ${body.description ?? response.statusText}`
      // 429 i 5xx są przejściowe; pozostałe 4xx (zły czat, brak uprawnień, zły token) nie miną same.
      if (response.status === 429 || response.status >= 500) throw new Error(description)
      throw new NonRetryableActionError(description)
    },
  }
}
