import { reactive, ref } from 'vue'
import type { NewsItem } from '@myorg/shared'
import { radarApi } from '../api/radar'

// News marked as read. Kept on the server (so phone and desktop agree); the list comes with
// GET /api/radar/dashboard. Marking hides the item at once (optimistic) and offers "Undo" for a while;
// when saving fails, the item comes back with a message.

const UNDO_MS = 6000

const readUrls = reactive(new Set<string>())

export interface ReadToast {
  item: Pick<NewsItem, 'url' | 'title'>
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

export function setReadUrls(urls: string[]): void {
  readUrls.clear()
  for (const url of urls) readUrls.add(url)
}

export function isRead(url: string): boolean {
  return readUrls.has(url)
}

export async function markRead(item: { url: string; title: string; source?: string | null }): Promise<void> {
  readUrls.add(item.url)
  showToast({ item, error: null })
  try {
    await radarApi.markRead(item)
  } catch (err) {
    readUrls.delete(item.url)
    showToast({ item, error: `Nie udało się zapisać: ${(err as Error).message}` })
  }
}

export async function undoRead(url: string): Promise<void> {
  dismissReadToast()
  readUrls.delete(url)
  try {
    await radarApi.unmarkRead(url)
  } catch {
    // The mark stays on the server; the item will be hidden again after the next dashboard load.
  }
}
