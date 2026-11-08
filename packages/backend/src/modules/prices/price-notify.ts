import type { PriceOfferKind, PriceSourceStatus } from '@myorg/shared'
import { config } from '../../config'
import { EmailSender } from '../scheduler/actions/delivery/email.client'
import { sendTelegramMessage } from '../scheduler/actions/delivery/telegram.client'
import type { OfferChange } from './price-evaluate'
import { type ItemRecord, PricesRepository, type SourceRecord } from './prices.repository'

// Powiadomienia o okazjach: zawsze zakładka „Okazje” (zapis w bazie), a dodatkowo — jeśli
// włączone w artykule — Telegram (chat id z artykułu) i e-mail (adres z artykułu).

export const KIND_LABELS: Record<PriceOfferKind, string> = {
  price_drop: 'Obniżka ceny',
  promo: 'Promocja',
  target_reached: 'Cena docelowa osiągnięta',
  back_in_stock: 'Znów dostępny',
  lowest_30d: 'Najniższa cena z 30 dni',
}

const money = (n: number | null, currency = 'PLN') =>
  n === null ? '—' : `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface Channels {
  telegram: (chatId: string, html: string, signal: AbortSignal) => Promise<void>
  email: (to: string, subject: string, text: string, html: string, messageId: string) => Promise<void>
}

export function defaultChannels(): Channels {
  const email = new EmailSender()
  return {
    async telegram(chatId, html, signal) {
      const token = config.integrations.telegram.botToken
      if (!token) throw new Error('Telegram nie jest skonfigurowany (TELEGRAM_BOT_TOKEN)')
      await sendTelegramMessage(token, { chatId, text: html, parseMode: 'HTML' }, signal)
    },
    async email(to, subject, text, html, messageId) {
      await email.send({ to: [to], subject, text, html }, messageId)
    },
  }
}

export function formatOffer(item: ItemRecord, source: SourceRecord, change: OfferChange) {
  const { offer } = change
  const drop =
    offer.dropAmount !== null ? ` (było ${money(offer.previousPrice, offer.currency)}, −${money(offer.dropAmount, offer.currency)} / −${offer.dropPct}%)` : ''
  const label = KIND_LABELS[offer.kind]
  const subject = `${label}: ${item.name} — ${money(offer.price, offer.currency)} w ${source.label}`
  const text = `${label}: ${item.name}\n${offer.title}\n${source.label}: ${money(offer.price, offer.currency)}${drop}\n${offer.url}`
  const html =
    `🔻 <b>${escapeHtml(label)}</b>: ${escapeHtml(item.name)}\n` +
    `${escapeHtml(offer.title)}\n` +
    `<b>${escapeHtml(source.label)}</b>: <b>${escapeHtml(money(offer.price, offer.currency))}</b>${escapeHtml(drop)}\n` +
    `<a href="${escapeHtml(offer.url)}">Otwórz ofertę</a>`
  return { subject, text, html }
}

export class PriceNotifier {
  constructor(
    private readonly repo = new PricesRepository(),
    private readonly channels: Channels = defaultChannels()
  ) {}

  /** Wysyła okazje włączonymi kanałami. Błąd wysyłki trafia do notify_error i nie przerywa pracy. */
  async notifyOffers(item: ItemRecord, source: SourceRecord, changes: OfferChange[]): Promise<void> {
    if (!item.notifyTelegram && !item.notifyEmail) return
    for (const change of changes) {
      const message = formatOffer(item, source, change)
      const errors: string[] = []
      if (item.notifyTelegram && item.telegramChatId) {
        await this.channels
          .telegram(item.telegramChatId, message.html, AbortSignal.timeout(15_000))
          .catch((err) => errors.push(`Telegram: ${(err as Error).message}`))
      }
      if (item.notifyEmail && item.emailTo) {
        const messageId = `<price-offer-${change.offer.id}-${change.offer.detectedAt.getTime()}@imbiro>`
        await this.channels
          .email(item.emailTo, message.subject, message.text, message.html.replace(/\n/g, '<br>'), messageId)
          .catch((err) => errors.push(`E-mail: ${(err as Error).message}`))
      }
      await this.repo.markNotified(change.offer.id, errors.length ? errors.join('; ') : null)
      if (errors.length) console.warn(`[prices] notification errors for offer ${change.offer.id}: ${errors.join('; ')}`)
    }
  }

  async notifyFailing(item: ItemRecord, source: SourceRecord, status: PriceSourceStatus, error: string): Promise<void> {
    const what = status === 'blocked' ? 'jest blokowane przez sklep' : 'przestało działać'
    const text = `⚠️ Źródło „${source.label}” (${item.name}) ${what}: ${error}`
    if (item.notifyTelegram && item.telegramChatId) {
      await this.channels.telegram(item.telegramChatId, escapeHtml(text), AbortSignal.timeout(15_000)).catch((err) => console.warn('[prices] failing alert (telegram):', (err as Error).message))
    }
    if (item.notifyEmail && item.emailTo) {
      await this.channels
        .email(item.emailTo, `Łowca cen: źródło ${source.label} ${what}`, text, escapeHtml(text), `<price-failing-${source.id}-${Date.now()}@imbiro>`)
        .catch((err) => console.warn('[prices] failing alert (email):', (err as Error).message))
    }
  }

  /** Wiadomość testowa z formularza (przed zapisem artykułu). */
  async sendTest(target: { channel: 'telegram'; telegramChatId: string } | { channel: 'email'; emailTo: string }): Promise<void> {
    const text = '✅ Łowca cen: wiadomość testowa. Powiadomienia o okazjach będą przychodzić tutaj.'
    if (target.channel === 'telegram') await this.channels.telegram(target.telegramChatId, text, AbortSignal.timeout(15_000))
    else await this.channels.email(target.emailTo, 'Łowca cen: wiadomość testowa', text, `<p>${text}</p>`, `<price-test-${Date.now()}@imbiro>`)
  }
}
