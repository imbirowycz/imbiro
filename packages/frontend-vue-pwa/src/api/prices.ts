import type { PriceChange, PriceItem, PriceOverview, SavePriceItemDTO, SavePriceSourceDTO } from '@myorg/shared'
import { request } from './client'

export { ApiRequestError } from './client'

export const pricesApi = {
  overview: () => request<PriceOverview>('GET', '/prices/overview'),
  createItem: (dto: SavePriceItemDTO) => request<PriceItem>('POST', '/prices/items', dto),
  updateItem: (id: string, dto: SavePriceItemDTO) => request<PriceItem>('PUT', `/prices/items/${id}`, dto),
  deleteItem: (id: string) => request<void>('DELETE', `/prices/items/${id}`),
  setItemEnabled: (id: string, enabled: boolean) => request<PriceItem>('POST', `/prices/items/${id}/${enabled ? 'enable' : 'disable'}`),
  checkNow: (id: string) => request<{ enqueued: number; sources: number }>('POST', `/prices/items/${id}/check-now`),
  changes: (id: string) => request<PriceChange[]>('GET', `/prices/items/${id}/changes`),
  addSource: (itemId: string, dto: SavePriceSourceDTO) => request<PriceItem>('POST', `/prices/items/${itemId}/sources`, dto),
  setSourceEnabled: (id: string, enabled: boolean) => request<PriceItem>('POST', `/prices/sources/${id}/${enabled ? 'enable' : 'disable'}`),
  checkSource: (id: string) => request<{ enqueued: boolean }>('POST', `/prices/sources/${id}/check-now`),
  deleteSource:(id: string) => request<PriceItem>('DELETE', `/prices/sources/${id}`),
  testNotification: (telegramChatId: string) => request<{ ok: true }>('POST', '/prices/notifications/test', { telegramChatId }),
}
