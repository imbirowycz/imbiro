import type {
  PriceDiscoveryDTO,
  PriceDiscoveryResult,
  PriceItem,
  PriceObservation,
  PriceOfferPage,
  PricePromptDTO,
  PricePromptResult,
  PriceFetchMode,
  PriceSnapshot,
  PriceSourceDefinition,
  PriceSourceTestResult,
  SavePriceItemDTO,
} from '@myorg/shared'
import { request } from './client'

export { ApiRequestError } from './client'

export interface OfferFilters {
  itemId?: string
  kind?: string
  unread?: boolean
  q?: string
  from?: string
  to?: string
  cursor?: string
}

function qs(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const pricesApi = {
  listItems: (filters: { q?: string; status?: string; enabled?: string } = {}) =>
    request<PriceItem[]>('GET', `/prices/items${qs(filters)}`),
  getItem: (id: string) => request<PriceItem>('GET', `/prices/items/${id}`),
  createItem: (dto: SavePriceItemDTO) => request<PriceItem>('POST', '/prices/items', dto),
  updateItem: (id: string, dto: SavePriceItemDTO) => request<PriceItem>('PUT', `/prices/items/${id}`, dto),
  deleteItem: (id: string) => request<void>('DELETE', `/prices/items/${id}`),
  setEnabled: (id: string, enabled: boolean) => request<PriceItem>('POST', `/prices/items/${id}/${enabled ? 'enable' : 'disable'}`),
  checkNow: (id: string) => request<{ enqueued: number; sources: number }>('POST', `/prices/items/${id}/check-now`),

  testSource: (dto: { url: string; fetchMode: PriceFetchMode; definition?: PriceSourceDefinition }) =>
    request<PriceSourceTestResult>('POST', '/prices/sources/test', dto),
  discover: (dto: PriceDiscoveryDTO) => request<PriceDiscoveryResult>('POST', '/prices/sources/discover', dto),
  snapshot: (dto: { url: string; fetchMode: PriceFetchMode }) => request<PriceSnapshot>('POST', '/prices/sources/snapshot', dto),
  prompt: (dto: PricePromptDTO) => request<PricePromptResult>('POST', '/prices/sources/prompt', dto),
  history: (sourceId: string) => request<PriceObservation[]>('GET', `/prices/sources/${sourceId}/history`),
  lastSnapshot: (sourceId: string) =>
    request<{ html: string; createdAt: string; fetcher: string | null; httpStatus: number | null }>('GET', `/prices/sources/${sourceId}/snapshot`),

  testNotification: (dto: { channel: 'telegram'; telegramChatId: string } | { channel: 'email'; emailTo: string }) =>
    request<{ ok: true }>('POST', '/prices/notifications/test', dto),

  listOffers: (filters: OfferFilters = {}) => request<PriceOfferPage>('GET', `/prices/offers${qs({ ...filters })}`),
  unreadCount: () => request<{ unread: number }>('GET', '/prices/offers/unread-count'),
  markRead: (ids: string[] | 'all') => request<{ updated: number }>('POST', '/prices/offers/read', ids === 'all' ? { all: true } : { ids }),
  dismiss: (ids: string[]) => request<{ updated: number }>('POST', '/prices/offers/dismiss', { ids }),
}
