<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { PriceItem, PriceOffer } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { KIND_LABELS, money, shortDate } from './format'
import { alertsEnabled, disableAlerts, enableAlerts, notificationPermission, testAlert } from './alerts'
import { refreshUnread } from './unread'
import './prices.css'

const route = useRoute()

const offers = ref<PriceOffer[]>([])
const items = ref<PriceItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref<string | null>(null)
const notice = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const selected = ref<Set<string>>(new Set())
const expanded = ref<Set<string>>(new Set())

const filters = ref({
  itemId: typeof route.query.itemId === 'string' ? route.query.itemId : '',
  kind: '',
  unread: false,
  q: '',
  from: '',
  to: '',
})

interface Group {
  itemId: string
  itemName: string
  best: PriceOffer
  others: PriceOffer[]
  unread: number
}

/** Najtańsza oferta artykułu na górze, pozostałe po rozwinięciu. */
const groups = computed<Group[]>(() => {
  const byItem = new Map<string, PriceOffer[]>()
  for (const offer of offers.value) {
    const list = byItem.get(offer.itemId) ?? []
    list.push(offer)
    byItem.set(offer.itemId, list)
  }
  return [...byItem.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => a.price - b.price || b.detectedAt.localeCompare(a.detectedAt))
      return {
        itemId: sorted[0].itemId,
        itemName: sorted[0].itemName,
        best: sorted[0],
        others: sorted.slice(1),
        unread: list.filter((o) => !o.readAt).length,
      }
    })
    .sort((a, b) => b.best.detectedAt.localeCompare(a.best.detectedAt))
})

function query() {
  const f = filters.value
  return {
    itemId: f.itemId || undefined,
    kind: f.kind || undefined,
    unread: f.unread || undefined,
    q: f.q.trim() || undefined,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined,
  }
}

async function load() {
  loading.value = true
  try {
    const page = await pricesApi.listOffers(query())
    offers.value = page.offers
    nextCursor.value = page.nextCursor
    loadError.value = null
    selected.value = new Set()
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextCursor.value) return
  loadingMore.value = true
  try {
    const page = await pricesApi.listOffers({ ...query(), cursor: nextCursor.value })
    offers.value = [...offers.value, ...page.offers]
    nextCursor.value = page.nextCursor
  } catch (err) {
    notice.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    loadingMore.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(
  filters,
  () => {
    clearTimeout(debounce)
    debounce = setTimeout(load, 300)
  },
  { deep: true }
)

async function markRead(ids: string[] | 'all') {
  try {
    await pricesApi.markRead(ids)
    const now = new Date().toISOString()
    offers.value = offers.value.map((o) => (ids === 'all' || ids.includes(o.id) ? { ...o, readAt: o.readAt ?? now } : o))
    await refreshUnread()
  } catch (err) {
    notice.value = { text: (err as Error).message, kind: 'error' }
  }
}

async function dismiss(ids: string[]) {
  if (!ids.length) return
  if (ids.length > 1 && !confirm(`Usunąć ${ids.length} okazje z listy? Wrócą tylko, jeśli cena spadnie jeszcze niżej.`)) return
  try {
    await pricesApi.dismiss(ids)
    offers.value = offers.value.filter((o) => !ids.includes(o.id))
    selected.value = new Set([...selected.value].filter((id) => !ids.includes(id)))
    notice.value = { text: ids.length === 1 ? 'Okazja usunięta.' : `Usunięto ${ids.length} okazje.`, kind: 'ok' }
    await refreshUnread()
  } catch (err) {
    notice.value = { text: (err as Error).message, kind: 'error' }
  }
}

function toggleSelected(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleExpanded(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function open(offer: PriceOffer) {
  if (!offer.readAt) void markRead([offer.id])
}

const alertBusy = ref(false)
async function toggleAlerts() {
  if (alertsEnabled.value) {
    disableAlerts()
    return
  }
  alertBusy.value = true
  try {
    const permission = await enableAlerts()
    await testAlert()
    notice.value =
      permission === 'granted'
        ? { text: 'Włączone: przy nowej okazji usłyszysz sygnał i zobaczysz powiadomienie (gdy aplikacja jest otwarta).', kind: 'ok' }
        : {
            text:
              permission === 'unsupported'
                ? 'Ta przeglądarka nie obsługuje powiadomień — zostaje sam dźwięk. Na iPhonie dodaj aplikację do ekranu głównego.'
                : 'Bez zgody na powiadomienia zostaje sam dźwięk. Zgodę włączysz w ustawieniach strony w przeglądarce.',
            kind: 'error',
          }
  } finally {
    alertBusy.value = false
  }
}

const differs = (o: PriceOffer) => o.currentPrice !== null && Math.abs(o.currentPrice - o.price) >= 0.01

onMounted(async () => {
  await load()
  items.value = await pricesApi.listItems().catch(() => [])
  await refreshUnread()
})
</script>

<template>
  <div class="pr-shell">
    <header class="pr-top">
      <div>
        <h1>Okazje</h1>
        <p class="pr-lede">Najtańsze znalezione oferty i obniżki</p>
      </div>
      <div class="pr-actions">
        <button v-if="selected.size" type="button" class="button danger" @click="dismiss([...selected])">Usuń zaznaczone ({{ selected.size }})</button>
        <button type="button" class="button" :disabled="!offers.some((o) => !o.readAt)" @click="markRead('all')">Oznacz wszystko jako przeczytane</button>
        <RouterLink class="button ghost" to="/ceny">Artykuły</RouterLink>
      </div>
    </header>

    <p v-if="notice" class="pr-notice" :class="notice.kind" role="status">
      {{ notice.text }}
      <button type="button" class="icon-button" aria-label="Ukryj komunikat" @click="notice = null">✕</button>
    </p>

    <div class="pr-card alerts">
      <label class="pr-check">
        <input type="checkbox" :checked="alertsEnabled" :disabled="alertBusy" @change="toggleAlerts" />
        <strong>Powiadomienia i dźwięk na tym urządzeniu</strong>
      </label>
      <span class="pr-muted">
        <template v-if="alertsEnabled">
          Włączone{{ notificationPermission === 'granted' ? '' : ' (tylko dźwięk — brak zgody na powiadomienia)' }} · działa, gdy aplikacja jest otwarta.
        </template>
        <template v-else>Sygnał i powiadomienie przy każdej nowej okazji, gdy aplikacja jest otwarta. Przy zamkniętej — użyj Telegrama.</template>
      </span>
      <button v-if="alertsEnabled" type="button" class="button ghost pr-small-button" @click="testAlert">Testuj</button>
    </div>

    <div class="pr-filters">
      <input v-model="filters.q" class="pr-search" type="search" placeholder="Szukaj (tytuł, artykuł, sklep)…" aria-label="Szukaj" />
      <select v-model="filters.itemId" aria-label="Artykuł">
        <option value="">Wszystkie artykuły</option>
        <option v-for="item in items" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <select v-model="filters.kind" aria-label="Rodzaj">
        <option value="">Każdy rodzaj</option>
        <option v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
      </select>
      <input v-model="filters.from" type="date" aria-label="Od dnia" />
      <input v-model="filters.to" type="date" aria-label="Do dnia" />
      <label class="pr-check"><input v-model="filters.unread" type="checkbox" /> Tylko nieprzeczytane</label>
    </div>

    <p v-if="loading && !offers.length" class="muted">Ładowanie…</p>
    <p v-else-if="loadError" class="pr-error-text">{{ loadError }}</p>
    <div v-else-if="!offers.length" class="pr-empty">
      <h2>Brak okazji</h2>
      <p>Gdy cena któregoś z obserwowanych artykułów spadnie, pojawi się promocja albo produkt wróci do sprzedaży, zobaczysz to tutaj.</p>
      <RouterLink class="button" to="/ceny">Obserwowane artykuły</RouterLink>
    </div>

    <ul v-else class="pr-list">
      <li v-for="group in groups" :key="group.itemId" class="pr-card group">
        <div class="group-head">
          <RouterLink :to="`/ceny/${group.itemId}`" class="item-name">{{ group.itemName }}</RouterLink>
          <span v-if="group.unread" class="pr-badge ok">{{ group.unread }} nowe</span>
        </div>

        <template v-for="offer in [group.best, ...(expanded.has(group.itemId) ? group.others : [])]" :key="offer.id">
          <article class="offer" :class="{ unread: !offer.readAt, best: offer.id === group.best.id }">
            <input type="checkbox" class="pick" :checked="selected.has(offer.id)" :aria-label="`Zaznacz ${offer.title}`" @change="toggleSelected(offer.id)" />
            <div class="offer-main">
              <p class="offer-title">
                <span class="pr-badge" :class="offer.kind === 'back_in_stock' ? 'warning' : 'ok'">{{ KIND_LABELS[offer.kind] }}</span>
                <a :href="offer.url" target="_blank" rel="noopener noreferrer" class="pr-link" @click="open(offer)">{{ offer.title }}</a>
              </p>
              <p class="pr-muted">
                {{ offer.sourceLabel }} · {{ shortDate(offer.detectedAt) }}
                <template v-if="offer.id === group.best.id && group.others.length"> · najtaniej z {{ group.others.length + 1 }} ofert</template>
              </p>
              <p v-if="differs(offer)" class="pr-muted current">
                Aktualnie {{ money(offer.currentPrice, offer.currency) }} (sprawdzono {{ shortDate(offer.currentCheckedAt) }})
              </p>
            </div>
            <div class="offer-price">
              <span class="pr-price">{{ money(offer.price, offer.currency) }}</span>
              <span v-if="offer.dropAmount" class="pr-drop">−{{ money(offer.dropAmount, offer.currency) }} (−{{ offer.dropPct }}%)</span>
              <span v-if="offer.previousPrice && offer.dropAmount" class="pr-muted"><s>{{ money(offer.previousPrice, offer.currency) }}</s></span>
            </div>
            <div class="offer-actions">
              <button v-if="!offer.readAt" type="button" class="button ghost pr-small-button" @click="markRead([offer.id])">Przeczytane</button>
              <button type="button" class="button ghost pr-small-button" @click="dismiss([offer.id])">Usuń</button>
            </div>
          </article>
        </template>

        <button v-if="group.others.length" type="button" class="button ghost pr-small-button more" @click="toggleExpanded(group.itemId)">
          {{ expanded.has(group.itemId) ? 'Ukryj inne oferty' : `Inne oferty (${group.others.length})` }}
        </button>
      </li>
    </ul>

    <div v-if="nextCursor" class="load-more">
      <button type="button" class="button" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? 'Ładowanie…' : 'Pokaż starsze' }}</button>
    </div>
  </div>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin-bottom: 1rem;
  padding: 0.7rem 1rem;
}
.alerts .pr-muted {
  flex: 1 1 16rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.item-name {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
}
.item-name:hover {
  color: var(--signal);
}
.offer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.4rem 0.9rem;
  align-items: start;
  padding-top: 0.6rem;
  border-top: 1px solid var(--line);
}
.offer.unread .offer-title a {
  font-weight: 600;
}
.offer:not(.best) {
  opacity: 0.85;
}
.pick {
  width: auto;
  margin-top: 0.3rem;
}
.offer-main p {
  margin: 0 0 0.2rem;
}
.offer-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  overflow-wrap: anywhere;
}
.offer-price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}
.offer-actions {
  grid-column: 2 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}
.current {
  color: var(--signal);
}
.more {
  align-self: flex-start;
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}
@media (max-width: 40rem) {
  .offer {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .offer-price {
    grid-column: 2;
    align-items: flex-start;
    text-align: left;
  }
  .offer-actions {
    justify-content: flex-start;
  }
}
</style>
