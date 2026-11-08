import { ref } from 'vue'
import { pricesApi } from '../api/prices'

// Licznik nieprzeczytanych okazji do odznaki w menu; odświeżany przez AppShell i stronę Okazje.
export const unreadOffers = ref(0)

export async function refreshUnread(): Promise<void> {
  try {
    unreadOffers.value = (await pricesApi.unreadCount()).unread
  } catch {
    // Brak licznika nie blokuje nawigacji.
  }
}
