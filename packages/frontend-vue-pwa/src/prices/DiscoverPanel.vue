<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PriceDiscoveryCandidate, PriceDiscoveryResult } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { money } from './format'

const props = defineProps<{ item: { name: string; description: string; ean: string }; existingUrls: string[] }>()
const emit = defineEmits<{ add: [candidates: PriceDiscoveryCandidate[]]; close: [] }>()

const result = ref<PriceDiscoveryResult | null>(null)
const searching = ref(false)
const error = ref<string | null>(null)
const picked = ref<Set<number>>(new Set())
let controller: AbortController | null = null

const STATUS: Record<PriceDiscoveryCandidate['status'], { label: string; cls: string }> = {
  found: { label: 'znaleziono', cls: 'ok' },
  not_found: { label: 'brak', cls: 'untested' },
  blocked: { label: 'blokuje', cls: 'failing' },
  error: { label: 'błąd', cls: 'warning' },
}

const order = (c: PriceDiscoveryCandidate) => (c.status === 'found' ? (c.check?.ok ? 0 : 1) : c.status === 'blocked' ? 2 : 3)
const rows = computed(() =>
  (result.value?.candidates ?? [])
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => order(a.candidate) - order(b.candidate) || (priceOf(a.candidate) ?? Infinity) - (priceOf(b.candidate) ?? Infinity))
)
const priceOf = (c: PriceDiscoveryCandidate) => c.check?.extraction?.price ?? null
/** Zablokowany sklep też można dodać — link do produktu wkleja się potem ze swojej przeglądarki. */
const canAdd = (c: PriceDiscoveryCandidate) => !!c.url || ((c.status === 'blocked' || c.status === 'error') && !!c.searchUrl)

async function search() {
  if (!props.item.name.trim()) {
    error.value = 'Najpierw podaj nazwę artykułu (najlepiej z kodem modelu, np. „Smeg BCC13BLMEU”) albo EAN.'
    return
  }
  searching.value = true
  error.value = null
  result.value = null
  controller = new AbortController()
  try {
    result.value = await pricesApi.discover({
      name: props.item.name,
      ean: props.item.ean || null,
      description: props.item.description || null,
      existingUrls: props.existingUrls,
    })
    // Domyślnie zaznaczone: znalezione strony z odczytaną ceną.
    picked.value = new Set(result.value.candidates.flatMap((c, i) => (c.status === 'found' && c.url && c.check?.ok ? [i] : [])))
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    searching.value = false
  }
}

function toggle(index: number) {
  const next = new Set(picked.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  picked.value = next
}

function add() {
  if (!result.value) return
  emit('add', [...picked.value].map((i) => result.value!.candidates[i]))
}

void search()
</script>

<template>
  <section class="pr-card discover" aria-live="polite">
    <header class="head">
      <h3>Znajdź źródła</h3>
      <button type="button" class="icon-button" aria-label="Zamknij" @click="emit('close')">✕</button>
    </header>

    <p v-if="searching" class="pr-muted">
      Szukam „{{ item.ean || item.name }}” na Ceneo i w wyszukiwarkach sklepów… To trwa zwykle 1–2 minuty (sklepy sprawdzane są po kolei, część
      przez przeglądarkę).
    </p>
    <p v-if="error" class="pr-error-text">{{ error }}</p>

    <template v-if="result">
      <p class="pr-muted">
        Fraza: <strong>{{ result.query }}</strong> ·
        <template v-if="result.ceneoUrl"><a :href="result.ceneoUrl" target="_blank" rel="noopener noreferrer" class="pr-link">produkt na Ceneo</a></template>
        <template v-else>nie znaleziono produktu na Ceneo</template>
        · {{ (result.durationMs / 1000).toFixed(0) }} s<template v-if="result.timedOut"> · przerwano po limicie czasu</template>
      </p>

      <ul class="rows">
        <li v-for="{ candidate: c, index } in rows" :key="index" :class="{ dim: c.status !== 'found' }">
          <label class="pick">
            <input type="checkbox" :disabled="!canAdd(c)" :checked="picked.has(index)" @change="toggle(index)" />
            <span class="shop">{{ c.shop }}</span>
          </label>
          <span class="pr-badge" :class="STATUS[c.status].cls">{{ STATUS[c.status].label }}</span>
          <span class="price">
            <template v-if="priceOf(c) !== null">{{ money(priceOf(c)) }}</template>
            <template v-else-if="c.ceneoPrice !== null"><span class="pr-muted">Ceneo: {{ money(c.ceneoPrice) }}</span></template>
          </span>
          <span class="detail">
            <a v-if="c.url" :href="c.url" target="_blank" rel="noopener noreferrer" class="pr-link url">{{ c.url.replace(/^https?:\/\/(www\.)?/, '') }}</a>
            <span v-if="c.message" class="pr-muted">{{ c.message }}</span>
            <a v-if="!c.url && c.searchUrl && c.status !== 'not_found'" :href="c.searchUrl" target="_blank" rel="noopener noreferrer" class="pr-link">
              Otwórz wyszukiwarkę sklepu ↗
            </a>
            <span v-if="c.check?.ok" class="pr-muted">odczyt: {{ c.check.extraction?.strategyUsed }} przez {{ c.check.fetcher }}</span>
          </span>
        </li>
      </ul>

      <p class="pr-muted">
        Sklepy „blokuje” odrzucają zapytania z tego serwera. Możesz je zaznaczyć i dodać: na karcie źródła otworzysz wyszukiwarkę sklepu u siebie i wkleisz
        link do produktu. Źródło będzie sprawdzane według harmonogramu, a gdy sklep zdejmie blokadę, ceny zaczną się pojawiać. „Znaleziono” bez ceny
        wymaga definicji od AI (przycisk „Kopiuj prompt” na karcie źródła).
      </p>
    </template>

    <div class="pr-actions">
      <button type="button" class="button primary pr-small-button" :disabled="searching || !picked.size" @click="add">
        Dodaj zaznaczone ({{ picked.size }})
      </button>
      <button type="button" class="button pr-small-button" :disabled="searching" @click="search">{{ searching ? 'Szukam…' : 'Szukaj ponownie' }}</button>
    </div>
  </section>
</template>

<style scoped>
.discover {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border-color: var(--signal);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rows li {
  display: grid;
  grid-template-columns: minmax(9rem, 14rem) auto 7rem minmax(0, 1fr);
  gap: 0.3rem 0.8rem;
  align-items: center;
  padding: 0.4rem 0;
  border-top: 1px solid var(--line);
  font-size: 0.9rem;
}
.rows li.dim {
  opacity: 0.7;
}
.pick {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.pick input {
  width: auto;
}
.shop {
  overflow-wrap: anywhere;
}
.price {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 44rem) {
  .rows li {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .detail {
    grid-column: 1 / -1;
    padding-left: 1.6rem;
  }
}
</style>
