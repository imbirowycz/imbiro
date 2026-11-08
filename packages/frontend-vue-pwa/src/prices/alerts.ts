import { ref } from 'vue'
import type { PriceOffer } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { KIND_LABELS, money } from './format'

// Powiadomienia o nowych okazjach na tym urządzeniu: systemowe powiadomienie + dźwięk.
// Działa, gdy aplikacja jest otwarta (także w tle, jeśli system jej nie uśpi).
// Bez push z serwera: zamknięta aplikacja nie dostanie powiadomienia (do tego służy Telegram).

const PREF_KEY = 'imbiro.offers.alerts'
const SEEN_KEY = 'imbiro.offers.lastAlertAt'

export const alertsEnabled = ref(readPref())
export const notificationPermission = ref<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
)

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1'
  } catch {
    return false
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Prywatny tryb — ustawienie działa tylko do zamknięcia karty.
  }
}

function lastSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

// ---------- dźwięk ----------

let audio: AudioContext | null = null

/** AudioContext trzeba utworzyć/odblokować w reakcji na kliknięcie użytkownika. */
function unlockAudio(): void {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

/** Krótki, dwutonowy sygnał „okazja” (generowany, bez pliku audio). */
export function playChime(): void {
  if (!audio) unlockAudio()
  if (!audio) return
  if (audio.state === 'suspended') void audio.resume()
  const now = audio.currentTime
  for (const [i, freq] of [880, 1318.5].entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = now + i * 0.16
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45)
    osc.connect(gain).connect(audio.destination)
    osc.start(start)
    osc.stop(start + 0.5)
  }
  navigator.vibrate?.([120, 60, 120])
}

// ---------- powiadomienia ----------

async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (notificationPermission.value !== 'granted') return
  const options: NotificationOptions = {
    body,
    tag,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    silent: false,
    data: { url: '/okazje' },
  }
  try {
    // W PWA (zwłaszcza na telefonie) powiadomienie musi przejść przez service worker.
    const registration = await Promise.race([
      navigator.serviceWorker?.getRegistration(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500)),
    ])
    if (registration) {
      await registration.showNotification(title, options)
      return
    }
  } catch {
    // spróbuj zwykłego powiadomienia
  }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      location.assign('/okazje')
      n.close()
    }
  } catch {
    // Przeglądarka nie obsługuje powiadomień poza service workerem.
  }
}

function describe(offer: PriceOffer): { title: string; body: string } {
  const drop = offer.dropAmount ? ` (−${money(offer.dropAmount, offer.currency)}, −${offer.dropPct}%)` : ''
  return {
    title: `${KIND_LABELS[offer.kind]}: ${offer.itemName}`,
    body: `${offer.sourceLabel}: ${money(offer.price, offer.currency)}${drop}\n${offer.title}`,
  }
}

/** Włączenie z przycisku (kliknięcie odblokowuje dźwięk i pozwala zapytać o zgodę). */
export async function enableAlerts(): Promise<NotificationPermission | 'unsupported'> {
  unlockAudio()
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    notificationPermission.value = await Notification.requestPermission()
  } else if (typeof Notification !== 'undefined') {
    notificationPermission.value = Notification.permission
  }
  alertsEnabled.value = true
  write(PREF_KEY, '1')
  // Powiadamiamy tylko o okazjach, które pojawią się od teraz. Punkt startowy z czasu serwera
  // (najnowsza okazja), żeby różnica zegarów telefonu i serwera nie gubiła okazji.
  let start = new Date().toISOString()
  try {
    const newest = (await pricesApi.listOffers()).offers[0]
    if (newest) start = newest.detectedAt
  } catch {
    // zostaje czas urządzenia
  }
  write(SEEN_KEY, start)
  return notificationPermission.value
}

export function disableAlerts(): void {
  alertsEnabled.value = false
  write(PREF_KEY, '0')
}

export async function testAlert(): Promise<void> {
  unlockAudio()
  playChime()
  await showNotification('Łowca cen: test', 'Tak będzie wyglądać powiadomienie o nowej okazji.', 'price-test')
}

/**
 * Sprawdza nowe okazje od ostatniego powiadomienia. Wołane cyklicznie przez AppShell.
 * Zwraca liczbę nowych okazji (0 = nic nowego).
 */
export async function checkNewOffers(): Promise<number> {
  if (!alertsEnabled.value) return 0
  const since = lastSeen()
  let offers: PriceOffer[]
  try {
    offers = (await pricesApi.listOffers({ unread: true, from: since })).offers.filter((o) => o.detectedAt > since)
  } catch {
    return 0
  }
  if (offers.length === 0) return 0
  write(SEEN_KEY, offers.reduce((max, o) => (o.detectedAt > max ? o.detectedAt : max), since))
  playChime()
  if (offers.length === 1) {
    const { title, body } = describe(offers[0])
    await showNotification(title, body, `price-offer-${offers[0].id}`)
  } else {
    const cheapest = [...offers].sort((a, b) => a.price - b.price)[0]
    await showNotification(`${offers.length} nowe okazje`, `Najtańsza: ${describe(cheapest).body}`, 'price-offers')
  }
  return offers.length
}
