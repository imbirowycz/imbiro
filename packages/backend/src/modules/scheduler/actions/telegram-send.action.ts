import { z } from 'zod'
import { config } from '../../../core/config'
import { parseWith } from './action.registry'
import { ActionConfigurationError, type ActionHandler } from './action.types'
import { sendTelegramMessage, TELEGRAM_MAX_TEXT, telegramChatIdSchema } from './delivery/telegram.client'

const configSchema = z.strictObject({
  chatId: telegramChatIdSchema,
  text: z.string().trim().min(1).max(TELEGRAM_MAX_TEXT),
  parseMode: z.enum(['HTML', 'MarkdownV2']).optional(),
  disableNotification: z.boolean().optional(),
})

export type TelegramSendConfig = z.output<typeof configSchema>

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
      const { messageId } = await sendTelegramMessage(token, message, context.signal, fetchImpl)
      return { messageId, chatId: message.chatId }
    },
  }
}
