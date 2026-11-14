<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PriceChange, PriceItem, PriceShop, SavePriceSourceDTO } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { clockTime, dateTime, relativeTime } from '../lib/format'
import { hostOf, money, sourceState } from './format'
import SourceAdder from './SourceAdder.vue'

// The popup of one item: price changes since tracking began and the sources with the result
// of their last fetch. Sources can be switched off, removed and added right here.

const props = defineProps<{ item: PriceItem; shops: PriceShop[]; now: number; collectorOnline: boolean; quietUntil: string | null }>()
const emit = defineEmits<{ updated: [item: PriceItem]; close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const changes = ref<PriceChange[] | null>(null)
const busy = ref(false)
const notice = ref<{ text: string; ok: boolean } | null>(null)

async function loadChanges() {
  try {
    changes.value = await pricesApi.changes(props.item.id)
  } catch {
    // The list refreshes with the next measurement; the previous content stays.
  }
}

async function perform(action: () => Promise<PriceItem | void>, done?: string) {
  busy.value = true
  notice.value = null
  try {
    const item = await action()
    if (item) emit('updated', item)
    if (done) notice.value = { text: done, ok: true }
  } catch (err) {
    notice.value = { text: (err as Error).message, ok: false }
  } finally {
    busy.value = false
  }
}

const waiting = () =>
  props.quietUntil
    ? `Zbieracz jest uśpiony do ${clockTime(props.quietUntil)} — sprawdzenie poczeka w kolejce.`
    : props.collectorOnline
      ? 'Wynik pojawi się w ciągu minuty.'
      : 'Zbieracz jest offline — sprawdzenie poczeka w kolejce.'

function checkNow() {
  void perform(async () => {
    await pricesApi.checkNow(props.item.id)
  }, `Zlecono sprawdzenie. ${waiting()}`)
}

function checkSource(id: string, label: string) {
  void perform(async () => {
    await pricesApi.checkSource(id)
  }, `Zlecono sprawdzenie źródła ${label}. ${waiting()}`)
}

function addSource(source: SavePriceSourceDTO) {
  void perform(() => pricesApi.addSource(props.item.id, source), `Dodano źródło ${source.label}. ${waiting()}`)
}

function removeSource(id: string, label: string) {
  if (!confirm(`Usunąć źródło „${label}” razem z jego historią cen?`)) return
  void perform(() => pricesApi.deleteSource(id))
}

onMounted(() => {
  dialog.value?.showModal()
  void loadChanges()
})
// A new measurement arrived (the page polls the overview): refresh the list of changes.
watch(() => props.item.summary.lastCheckedAt, loadChanges)
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="item-dialog-title" @close="emit('close')" @cancel.prevent="emit('close')" @click.self="emit('close')">
    <div class="body">
      <header class="head">
        <div>
          <h2 id="item-dialog-title">{{ item.name }}</h2>
          <p class="muted">
            <template v-if="item.summary.bestPrice !== null">
              najniżej {{ money(item.summary.bestPrice, item.summary.currency) }} w {{ item.summary.bestSourceLabel }}
            </template>
            <template v-else>brak ceny</template>
            <template v-if="item.targetPrice !== null"> · cena minimalna {{ money(item.targetPrice) }}</template>
          </p>
        </div>
        <button type="button" class="icon-button" aria-label="Zamknij" @click="emit('close')">✕</button>
      </header>

      <p v-if="notice" class="notice" :class="{ error: !notice.ok }" role="status">{{ notice.text }}</p>

      <section aria-labelledby="sources-title">
        <div class="section-head">
          <h3 id="sources-title">Źródła</h3>
          <button type="button" class="button" :disabled="busy || !item.sources.some((s) => s.enabled)" @click="checkNow">Sprawdź teraz</button>
        </div>
        <ul v-if="item.sources.length" class="sources">
          <li v-for="source in item.sources" :key="source.id" :class="{ off: !source.enabled }">
            <div class="source-main">
              <a :href="source.url" target="_blank" rel="noopener noreferrer" class="source-name" :title="source.url">{{ source.label }}</a>
              <span class="muted host">{{ hostOf(source.url) }}</span>
            </div>
            <span class="source-price">{{ money(source.lastPrice) }}</span>
            <div class="source-state">
              <span class="state" :class="sourceState(source).tone">{{ sourceState(source).label }}</span>
              <span v-if="source.lastCheckedAt" class="muted" :title="dateTime(source.lastCheckedAt)">{{ relativeTime(source.lastCheckedAt, now) }}</span>
            </div>
            <div class="source-actions">
              <button v-if="source.enabled" type="button" class="button ghost" :disabled="busy" @click="checkSource(source.id, source.label)">Sprawdź</button>
              <button type="button" class="button ghost" :disabled="busy" @click="perform(() => pricesApi.setSourceEnabled(source.id, !source.enabled))">
                {{ source.enabled ? 'Wyłącz' : 'Włącz' }}
              </button>
              <button type="button" class="button ghost danger" :disabled="busy" @click="removeSource(source.id, source.label)">Usuń</button>
            </div>
            <p v-if="source.enabled && source.lastError && source.status !== 'ok'" class="source-error">
              {{ source.lastError }}
              <template v-if="source.status === 'blocked'"> — do odblokowania sprawdzane tylko raz na dobę.</template>
            </p>
          </li>
        </ul>
        <p v-else class="muted">Ten artykuł nie ma jeszcze żadnego źródła.</p>
        <SourceAdder :shops="shops" :item-name="item.name" :busy="busy" @add="addSource" />
      </section>

      <section aria-labelledby="changes-title">
        <h3 id="changes-title">Zmiany cen</h3>
        <p v-if="changes === null" class="muted">Ładowanie…</p>
        <p v-else-if="!changes.length" class="muted">Jeszcze nic nie zmierzono. Pierwsza cena pojawi się po sprawdzeniu źródeł.</p>
        <table v-else class="changes">
          <thead>
            <tr>
              <th scope="col">Kiedy</th>
              <th scope="col">Źródło</th>
              <th scope="col" class="num">Cena</th>
              <th scope="col" class="num">Zmiana</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="change in changes" :key="`${change.sourceId}-${change.at}`">
              <td>{{ dateTime(change.at) }}</td>
              <td>{{ change.sourceLabel }}</td>
              <td class="num">{{ money(change.price, change.currency) }}</td>
              <td v-if="change.previousPrice === null" class="num muted">pierwszy pomiar</td>
              <td v-else class="num" :class="change.price < change.previousPrice ? 'down' : 'up'">
                {{ change.price < change.previousPrice ? '−' : '+' }}{{ money(Math.abs(change.price - change.previousPrice), change.currency) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: min(46rem, calc(100vw - 1.5rem));
  max-height: calc(100dvh - 1.5rem);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  color: var(--ink);
}
.sheet::backdrop {
  background: rgb(5 10 20 / 0.7);
}
.body {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  padding: 1.25rem 1.4rem 1.5rem;
}
.head,
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.section-head {
  align-items: center;
  margin-bottom: 0.6rem;
}
h2,
h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
}
h2 {
  font-size: 1.6rem;
  line-height: 1.15;
}
h3 {
  font-size: 1.1rem;
  color: var(--signal);
}
.head p {
  margin: 0.25rem 0 0;
}
section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.section-head + .sources,
.section-head {
  margin-bottom: 0;
}
.notice {
  margin: 0;
  padding: 0.55rem 0.8rem;
  border-radius: 8px;
  background: rgb(92 200 164 / 0.12);
  color: var(--ok);
}
.notice.error {
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.sources {
  display: flex;
  flex-direction: column;
  margin: 0 0 0.4rem;
  padding: 0;
  list-style: none;
}
.sources li {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) auto minmax(7rem, auto) auto;
  align-items: center;
  gap: 0.2rem 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--line);
}
.sources li.off .source-main,
.sources li.off .source-price {
  opacity: 0.55;
}
.source-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.source-name {
  overflow: hidden;
  color: var(--ink);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host {
  overflow: hidden;
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-price {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}
.source-state {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
}
.state::before {
  content: '';
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  margin-right: 0.4rem;
  border-radius: 50%;
  background: currentColor;
}
.state.ok {
  color: var(--ok);
}
.state.warn {
  color: var(--warn);
}
.state.fail {
  color: var(--fail);
}
.state.idle {
  color: var(--muted);
}
.source-actions {
  display: flex;
  gap: 0.35rem;
}
.source-actions .button {
  padding: 0.3rem 0.6rem;
  font-size: 0.85rem;
}
.danger:hover:not(:disabled) {
  border-color: var(--fail);
  color: var(--fail);
}
.source-error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--warn);
  font-size: 0.85rem;
}
.changes {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.changes th {
  padding: 0.3rem 0.5rem 0.3rem 0;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-weight: 500;
  text-align: left;
}
.changes td {
  padding: 0.4rem 0.5rem 0.4rem 0;
  border-bottom: 1px solid var(--line);
}
.changes .num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.down {
  color: var(--ok);
}
.up {
  color: var(--fail);
}
@media (max-width: 38rem) {
  .body {
    padding: 1rem;
  }
  .sources li {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .source-actions {
    justify-content: flex-end;
  }
}
</style>
