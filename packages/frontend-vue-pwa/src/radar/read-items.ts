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
  /** Everything "Undo" brings back: one item, or a whole section. */
  keys: string[]
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
  showToast({ keys: [key], title, error: null })
  try {
    await radarApi.markRead(body)
  } catch (err) {
    readKeys.delete(key)
    showToast({ keys: [key], title, error: `Nie udało się zapisać: ${(err as Error).message}` })
  }
}

/** The server keeps at most 300 characters of a title (it is only a label for the mark). */
const label = (text: string) => text.slice(0, 300)

const newsBody = (item: { url: string; title: string; source?: string | null }): MarkReadBody => ({
  kind: 'news',
  url: item.url,
  title: label(item.title),
  source: item.source ?? null,
})

const alertBody = (alert: AlertItem): MarkReadBody => ({
  kind: 'alert',
  id: alert.id,
  issuedAt: alert.issuedAt,
  validFrom: alert.validFrom,
  expiresAt: alert.expiresAt,
  title: label(alert.title),
  source: alert.source,
})

export function markNewsRead(item: { url: string; title: string; source?: string | null }): Promise<void> {
  return mark(newsReadKey(item.url), item.title, newsBody(item))
}

export function markAlertRead(alert: AlertItem): Promise<void> {
  return mark(alertReadKey(alert), alert.title, alertBody(alert))
}

/** Unread news and alerts of a section (failed sources skipped) — what "mark all as read" covers. */
export function unreadItems(results: readonly (ModuleResult | null)[]): { key: string; body: MarkReadBody }[] {
  const items = new Map<string, MarkReadBody>()
  for (const result of results) {
    if (!result || result.status === 'error') continue
    for (const item of result.data) {
      if (result.itemKind === 'news') {
        const news = item as NewsItem
        if (!isNewsRead(news.url)) items.set(newsReadKey(news.url), newsBody(news))
      } else if (result.itemKind === 'alert') {
        const alert = item as AlertItem
        if (!isAlertRead(alert)) items.set(alertReadKey(alert), alertBody(alert))
      }
    }
  }
  return [...items].map(([key, body]) => ({ key, body }))
}

/** Marks every unread news/alert of a section at once (one request); "Undo" brings all of them back. */
export async function markAllRead(sectionTitle: string, results: readonly (ModuleResult | null)[]): Promise<void> {
  const items = unreadItems(results)
  if (items.length === 0) return
  const keys = items.map((i) => i.key)
  const title = `wszystko w sekcji ${sectionTitle} (${items.length})`
  for (const key of keys) readKeys.add(key)
  showToast({ keys, title, error: null })
  try {
    await radarApi.markManyRead(items.map((i) => i.body))
  } catch (err) {
    for (const key of keys) readKeys.delete(key)
    showToast({ keys, title, error: `Nie udało się zapisać: ${(err as Error).message}` })
  }
}

export async function undoRead(keys: string[]): Promise<void> {
  dismissReadToast()
  for (const key of keys) readKeys.delete(key)
  try {
    if (keys.length === 1) await radarApi.unmarkRead(keys[0])
    else await radarApi.unmarkManyRead(keys)
  } catch {
    // The marks stay on the server; the items will be hidden again after the next dashboard load.
  }
}
