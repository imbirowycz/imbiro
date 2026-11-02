import { reactive, ref } from 'vue'
import { alertReadKey, newsReadKey, type AlertItem, type ModuleResult, type NewsItem } from '@myorg/shared'
import { radarApi, type MarkReadBody } from '../api/radar'

// News and alerts marked as read. Kept on the server (so phone and desktop agree); the keys come with
// GET /api/radar/dashboard. Marking hides the item at once (optimistic) and offers "Undo" for a while;
// when saving fails, the item comes back with a message. Keys: newsReadKey / alertReadKey (@myorg/shared),
// the same functions the server uses.

const UNDO_MS = 6000

const readKeys = reactive(new Set<string>())

export interface ReadToast {
  key: string
  title: string
  /** Set when saving failed — the item is visible again and the toast explains why. */
  error: string | null
}

export const readToast = ref<ReadToast | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(toast: ReadToast) {
  clearTimeout(toastTimer)
  readToast.value = toast
  toastTimer = setTimeout(() => (readToast.value = null), UNDO_MS)
}

export function dismissReadToast() {
  clearTimeout(toastTimer)
  readToast.value = null
}

export function setReadKeys(keys: string[]): void {
  readKeys.clear()
  for (const key of keys) readKeys.add(key)
}

export const isNewsRead = (url: string) => readKeys.has(newsReadKey(url))
export const isAlertRead = (alert: AlertItem) => readKeys.has(alertReadKey(alert))

/**
 * True when a section has items and every one of them is a news/alert marked as read
 * (sections with weather, rates etc. never count as "all read"). Failed sources are ignored.
 */
export function allItemsRead(results: readonly (ModuleResult | null)[]): boolean {
  let items = 0
  for (const result of results) {
    if (!result || result.status === 'error') continue
    for (const item of result.data) {
      items++
      if (result.itemKind === 'news' && isNewsRead((item as NewsItem).url)) continue
      if (result.itemKind === 'alert' && isAlertRead(item as AlertItem)) continue
      return false
    }
  }
  return items > 0
}

async function mark(key: string, title: string, body: MarkReadBody): Promise<void> {
  readKeys.add(key)
  showToast({ key, title, error: null })
  try {
    await radarApi.markRead(body)
  } catch (err) {
    readKeys.delete(key)
    showToast({ key, title, error: `Nie udało się zapisać: ${(err as Error).message}` })
  }
}

export function markNewsRead(item: { url: string; title: string; source?: string | null }): Promise<void> {
  return mark(newsReadKey(item.url), item.title, { kind: 'news', url: item.url, title: item.title, source: item.source ?? null })
}

export function markAlertRead(alert: AlertItem): Promise<void> {
  return mark(alertReadKey(alert), alert.title, {
    kind: 'alert',
    id: alert.id,
    issuedAt: alert.issuedAt,
    validFrom: alert.validFrom,
    expiresAt: alert.expiresAt,
    title: alert.title,
    source: alert.source,
  })
}

export async function undoRead(key: string): Promise<void> {
  dismissReadToast()
  readKeys.delete(key)
  try {
    await radarApi.unmarkRead(key)
  } catch {
    // The mark stays on the server; the item will be hidden again after the next dashboard load.
  }
}
