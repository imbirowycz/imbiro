import { z } from 'zod'
import { NonRetryableActionError } from '../action.types'

// Telegram Bot API client shared by `telegram.send` and `radar.deliver`.

/** Numeric chat id (groups are negative) or @channel_name. */
export const telegramChatIdSchema = z.union([
  z.number().int(),
  z.string().regex(/^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/, 'Must be a numeric chat id or @channel'),
])

export const TELEGRAM_MAX_TEXT = 4096

export interface TelegramMessage {
  chatId: number | string
  text: string
  parseMode?: 'HTML' | 'MarkdownV2'
  disableNotification?: boolean
  disableLinkPreview?: boolean
}

interface TelegramResponse {
  ok: boolean
  result?: { message_id: number }
  error_code?: number
  description?: string
}

/**
 * Sends one message. Transient failures (network, 429, 5xx) throw a plain Error so the
 * scheduler retries; permanent ones (bad chat, no rights, bad token) throw NonRetryableActionError.
 */
export async function sendTelegramMessage(
  token: string,
  message: TelegramMessage,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ messageId: number }> {
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
        link_preview_options: message.disableLinkPreview ? { is_disabled: true } : undefined,
      }),
      signal,
    })
  } catch (err) {
    // No URL in the message — it contains the token.
    throw new Error(`Telegram request failed: ${(err as Error).message}`)
  }

  const body = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse
  if (response.ok && body.ok && body.result) {
    return { messageId: body.result.message_id }
  }

  const description = `Telegram API error ${body.error_code ?? response.status}: ${body.description ?? response.statusText}`
  // 429 and 5xx are transient; other 4xx (bad chat, no rights, bad token) will not fix themselves.
  if (response.status === 429 || response.status >= 500) throw new Error(description)
  throw new NonRetryableActionError(description)
}
