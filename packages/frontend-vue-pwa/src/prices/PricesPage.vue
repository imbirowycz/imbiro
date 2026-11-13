<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PriceItem, PriceOverview } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { relativeTime } from '../lib/format'
import ItemCard from './ItemCard.vue'
import ItemDialog from './ItemDialog.vue'
import ItemForm from './ItemForm.vue'

// The "Okazje" page: tracked items as cards, the form for adding/editing inline, details in a popup.

const POLL_MS = 10_000

const overview = ref<PriceOverview | null>(null)
const loadError = ref<string | null>(null)
const notice = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const busy = ref(false)
const now = ref(Date.now())
/** `null` = closed, `{ item: null }` = a new item, `{ item }` = editing. */
const form = ref<{ item: PriceItem | null } | null>(null)
const openId = ref<string | null>(null)

const items = computed(() => overview.value?.items ?? [])
const collector = computed(() => overview.value?.collector ?? null)
const opened = computed(() => items.value.find((item) => item.id === openId.value) ?? null)
const defaultChatId = computed(() => items.value.find((item) => item.notify.telegramChatId)?.notify.telegramChatId ?? null)

async function load() {
  try {
    overview.value = await pricesApi.overview()
    loadError.value = null
  } catch (err) {
    loadError.value = (err as Error).message
  }
}

function replaceItem(item: PriceItem) {
  if (!overview.value) return
  const index = overview.value.items.findIndex((other) => other.id === item.id)
  if (index === -1) overview.value.items.unshift(item)
  else overview.value.items[index] = item
}

async function perform(action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
  } catch (err) {
    notice.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    busy.value = false
  }
}

function toggle(item: PriceItem) {
  void perform(async () => {
    replaceItem(await pricesApi.setItemEnabled(item.id, !item.enabled))
  })
}

function remove(item: PriceItem) {
  if (!confirm(`Usunąć „${item.name}” razem ze źródłami i historią cen?`)) return
  void perform(async () => {
    await pricesApi.deleteItem(item.id)
    if (overview.value) overview.value.items = overview.value.items.filter((other) => other.id !== item.id)
    if (form.value?.item?.id === item.id) form.value = null
    notice.value = { text: `Usunięto „${item.name}”.`, kind: 'ok' }
  })
}

function onSaved(item: PriceItem) {
  const isNew = !form.value?.item
  replaceItem(item)
  form.value = null
  notice.value = { text: isNew ? `Dodano „${item.name}”. Pierwsze sprawdzenie zlecone.` : `Zapisano „${item.name}”.`, kind: 'ok' }
  // A new item is checked right away instead of waiting for its schedule.
  if (isNew && item.sources.length) void pricesApi.checkNow(item.id).catch(() => {})
}

function openForm(item: PriceItem | null) {
  form.value = { item }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  now.value = Date.now()
  if (document.visibilityState === 'visible') void load()
}
onMounted(() => {
  void load()
  timer = setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', tick)
})
</script>

<template>
  <div class="shell">
    <header class="top">
      <div>
        <h1>Okazje</h1>
        <p class="lede">Śledzone artykuły i ich ceny w sklepach</p>
      </div>
      <div class="top-actions">
        <span v-if="collector" class="collector" :class="{ online: collector.online }">
          zbieracz:
          <template v-if="collector.online">online</template>
          <template v-else-if="collector.lastSeenAt">offline, ostatnio {{ relativeTime(collector.lastSeenAt, now) }}</template>
          <template v-else>jeszcze się nie połączył</template>
          <template v-if="collector.queued"> · w kolejce: {{ collector.queued }}</template>
        </span>
        <button v-if="!form" type="button" class="button primary" @click="openForm(null)">Dodaj artykuł</button>
      </div>
    </header>

    <p v-if="notice" class="notice" :class="notice.kind" role="status">
      {{ notice.text }}
      <button type="button" class="icon-button" aria-label="Ukryj komunikat" @click="notice = null">✕</button>
    </p>

    <!-- The key recreates the form when another item is picked for editing. -->
    <ItemForm
      v-if="form && overview"
      :key="form.item?.id ?? 'new'"
      class="form"
      :item="form.item"
      :shops="overview.shops"
      :default-chat-id="defaultChatId"
      @saved="onSaved"
      @close="form = null"
    />

    <p v-if="!overview && !loadError" class="muted">Ładowanie…</p>
    <p v-else-if="loadError && !overview" class="load-error">{{ loadError }}</p>
    <div v-else-if="!items.length && !form" class="empty">
      <h2>Nic jeszcze nie śledzisz</h2>
      <p>Dodaj artykuł, wskaż strony produktu w sklepach i ustal cenę minimalną. Ceny pobiera zbieracz z domowego łącza.</p>
      <button type="button" class="button primary" @click="openForm(null)">Dodaj pierwszy artykuł</button>
    </div>
    <section v-else class="cards" aria-label="Śledzone artykuły">
      <ItemCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :now="now"
        :busy="busy"
        @open="openId = item.id"
        @edit="openForm(item)"
        @toggle="toggle(item)"
        @remove="remove(item)"
      />
    </section>

    <ItemDialog
      v-if="opened && overview"
      :key="opened.id"
      :item="opened"
      :shops="overview.shops"
      :now="now"
      :collector-online="!!collector?.online"
      @updated="replaceItem"
      @close="openId = null"
    />
  </div>
</template>

<style scoped>
.shell {
  max-width: 62rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
}
.top h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 600;
  line-height: 1;
}
.lede {
  margin: 0.35rem 0 0;
  color: var(--muted);
}
.top-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1rem;
}
.collector {
  color: var(--warn);
  font-size: 0.9rem;
}
.collector::before {
  content: '';
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  margin-right: 0.4rem;
  border-radius: 50%;
  background: currentColor;
}
.collector.online {
  color: var(--ok);
}
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 0 1rem;
  padding: 0.5rem 0.5rem 0.5rem 0.9rem;
  border-radius: 8px;
  background: rgb(92 200 164 / 0.12);
  color: var(--ok);
}
.notice.error {
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.form {
  margin-bottom: 1.25rem;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.empty {
  max-width: 34rem;
  padding: 2rem 0;
}
.empty h2 {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
}
.empty p {
  margin: 0 0 1.25rem;
  color: var(--muted);
}
.load-error {
  color: var(--fail);
}
@media (max-width: 30rem) {
  .top h1 {
    font-size: 1.9rem;
  }
}
</style>
