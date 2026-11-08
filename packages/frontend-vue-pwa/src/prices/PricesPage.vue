<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PriceItem } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { money, scheduleLabel, shortDate, STATUS_LABELS } from './format'
import './prices.css'

defineOptions({ name: 'PricesPage' })

const items = ref<PriceItem[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const notice = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const busyId = ref<string | null>(null)

const q = ref('')
const status = ref<'' | 'problem' | 'ok'>('')
const enabled = ref<'' | 'true' | 'false'>('')
const withOffers = ref(false)

const visible = computed(() => {
  const text = q.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (text && !`${item.name} ${item.description ?? ''} ${item.sources.map((s) => s.label).join(' ')}`.toLowerCase().includes(text)) return false
    if (status.value === 'problem' && item.summary.problemSources === 0) return false
    if (status.value === 'ok' && item.summary.problemSources > 0) return false
    if (enabled.value && String(item.enabled) !== enabled.value) return false
    if (withOffers.value && item.summary.unreadOffers === 0) return false
    return true
  })
})

async function load() {
  try {
    items.value = await pricesApi.listItems()
    loadError.value = null
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function perform(id: string, action: () => Promise<void>) {
  busyId.value = id
  try {
    await action()
  } catch (err) {
    notice.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    busyId.value = null
  }
}

function checkNow(item: PriceItem) {
  return perform(item.id, async () => {
    const result = await pricesApi.checkNow(item.id)
    notice.value = {
      text: result.enqueued
        ? `Sprawdzanie „${item.name}” w kolejce (${result.enqueued} z ${result.sources} źródeł). Wyniki pojawią się za chwilę.`
        : 'Sprawdzenie już czeka w kolejce.',
      kind: 'ok',
    }
    setTimeout(load, 8000)
  })
}

function toggle(item: PriceItem) {
  return perform(item.id, async () => {
    const updated = await pricesApi.setEnabled(item.id, !item.enabled)
    items.value = items.value.map((i) => (i.id === updated.id ? updated : i))
  })
}

function remove(item: PriceItem) {
  if (!confirm(`Usunąć „${item.name}”?\n\nZniknie razem ze wszystkimi źródłami, historią cen, okazjami i harmonogramem.`)) return
  return perform(item.id, async () => {
    await pricesApi.deleteItem(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
    notice.value = { text: `Usunięto „${item.name}”.`, kind: 'ok' }
  })
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="pr-shell">
    <header class="pr-top">
      <div>
        <h1>Łowca cen</h1>
        <p class="pr-lede">Obserwowane artykuły i ich źródła</p>
      </div>
      <div class="pr-actions">
        <RouterLink class="button" to="/okazje">Okazje</RouterLink>
        <RouterLink class="button primary" to="/ceny/nowy">Nowy artykuł</RouterLink>
      </div>
    </header>

    <p v-if="notice" class="pr-notice" :class="notice.kind" role="status">
      {{ notice.text }}
      <button type="button" class="icon-button" aria-label="Ukryj komunikat" @click="notice = null">✕</button>
    </p>

    <div v-if="items.length" class="pr-filters">
      <input v-model="q" class="pr-search" type="search" placeholder="Szukaj artykułu albo sklepu…" aria-label="Szukaj" />
      <select v-model="status" aria-label="Stan źródeł">
        <option value="">Wszystkie źródła</option>
        <option value="problem">Z problemem</option>
        <option value="ok">Bez problemów</option>
      </select>
      <select v-model="enabled" aria-label="Aktywność">
        <option value="">Aktywne i wyłączone</option>
        <option value="true">Tylko aktywne</option>
        <option value="false">Tylko wyłączone</option>
      </select>
      <label class="pr-check"><input v-model="withOffers" type="checkbox" /> Nowe okazje</label>
    </div>

    <p v-if="loading" class="muted">Ładowanie…</p>
    <p v-else-if="loadError && !items.length" class="pr-error-text">{{ loadError }}</p>
    <div v-else-if="!items.length" class="pr-empty">
      <h2>Niczego jeszcze nie obserwujesz</h2>
      <p>Dodaj artykuł, np. konkretny model kawiarki, wklej linki do sklepów i definicje źródeł wygenerowane przez AI. System będzie sprawdzał ceny według harmonogramu.</p>
      <RouterLink class="button primary" to="/ceny/nowy">Dodaj pierwszy artykuł</RouterLink>
    </div>
    <p v-else-if="!visible.length" class="muted">Brak artykułów pasujących do filtrów.</p>

    <ul v-else class="pr-list">
      <li v-for="item in visible" :key="item.id" class="pr-card item" :class="{ off: !item.enabled }">
        <div class="item-head">
          <div class="item-title">
            <RouterLink :to="`/ceny/${item.id}`" class="name">{{ item.name }}</RouterLink>
            <span v-if="!item.enabled" class="pr-badge untested">wyłączony</span>
            <RouterLink v-if="item.summary.unreadOffers" :to="`/okazje?itemId=${item.id}`" class="pr-badge ok">
              {{ item.summary.unreadOffers }} {{ item.summary.unreadOffers === 1 ? 'nowa okazja' : 'nowe okazje' }}
            </RouterLink>
          </div>
          <div class="best">
            <span class="pr-price">{{ money(item.summary.bestPrice, item.summary.currency) }}</span>
            <span v-if="item.summary.bestSourceLabel" class="pr-muted">najtaniej: {{ item.summary.bestSourceLabel }}</span>
          </div>
        </div>

        <p class="pr-muted meta">
          {{ scheduleLabel(item.schedule) }} · ostatnio {{ shortDate(item.summary.lastCheckedAt) }}
          <template v-if="item.enabled && item.nextRunAt"> · następnie {{ shortDate(item.nextRunAt) }}</template>
          <template v-if="item.targetPrice"> · cel {{ money(item.targetPrice) }}</template>
        </p>

        <ul class="sources">
          <li v-for="source in item.sources" :key="source.id" class="source">
            <a :href="source.url" target="_blank" rel="noopener noreferrer" class="source-label">{{ source.label }}</a>
            <span class="source-price">{{ money(source.lastPrice) }}</span>
            <span v-if="source.lastAvailable === false" class="pr-muted">niedostępny</span>
            <span class="pr-badge" :class="source.status" :title="source.lastError ?? undefined">{{ STATUS_LABELS[source.status] }}</span>
            <span v-if="source.status !== 'ok' && source.lastError" class="pr-error-text source-error">{{ source.lastError }}</span>
          </li>
          <li v-if="!item.sources.length" class="pr-muted">Brak źródeł — dodaj je w edycji.</li>
        </ul>

        <div class="pr-actions item-actions">
          <RouterLink class="button pr-small-button" :to="`/ceny/${item.id}`">Edytuj</RouterLink>
          <button type="button" class="button pr-small-button" :disabled="busyId === item.id || !item.sources.length" @click="checkNow(item)">Sprawdź teraz</button>
          <button type="button" class="button ghost pr-small-button" :disabled="busyId === item.id" @click="toggle(item)">
            {{ item.enabled ? 'Wyłącz' : 'Włącz' }}
          </button>
          <button type="button" class="button danger pr-small-button" :disabled="busyId === item.id" @click="remove(item)">Usuń</button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.item.off {
  opacity: 0.7;
}
.item-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
}
.item-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.name {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  text-decoration: none;
}
.name:hover {
  color: var(--signal);
}
.best {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.meta {
  margin: 0.25rem 0 0.75rem;
}
.sources {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0 0 0.9rem;
  padding: 0;
  list-style: none;
}
.source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
  padding: 0.35rem 0;
  border-top: 1px solid var(--line);
}
.source-label {
  flex: 1 1 10rem;
  min-width: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.source-price {
  font-variant-numeric: tabular-nums;
}
.source-error {
  flex-basis: 100%;
}
@media (max-width: 40rem) {
  .best {
    align-items: flex-start;
  }
}
</style>
