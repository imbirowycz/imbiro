<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PriceFetchMode } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { ERROR_HINTS, FETCH_MODE_LABELS, money, STATUS_LABELS } from './format'
import { AUTO_DEFINITION, parseDefinition, REFUSAL_HINTS, type SourceDraft } from './source-draft'

const props = defineProps<{
  source: SourceDraft
  index: number
  count: number
  item: { name: string; description: string; ean: string }
  errors: Record<string, string>
}>()
const emit = defineEmits<{ remove: []; move: [delta: number] }>()

const testing = ref(false)
const promptBusy = ref<'new' | 'repair' | 'html' | null>(null)
const message = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const promptText = ref<string | null>(null)

const parsed = computed(() => parseDefinition(props.source.definitionText))
const fieldError = (name: string) => props.errors[`sources.${props.index}.${name}`]
const definitionErrors = computed(() =>
  Object.entries(props.errors)
    .filter(([path]) => path.startsWith(`sources.${props.index}.definition`))
    .map(([path, msg]) => `${path.replace(`sources.${props.index}.definition`, 'definicja')}: ${msg}`)
)

function canFetch(): boolean {
  if (!/^https?:\/\/.+/i.test(props.source.url.trim())) {
    message.value = { text: 'Najpierw wklej pełny link do produktu w tym sklepie.', kind: 'error' }
    return false
  }
  return true
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function copyPrompt(mode: 'new' | 'repair') {
  if (!canFetch()) return
  if (!props.item.name.trim()) {
    message.value = { text: 'Najpierw podaj nazwę artykułu (sekcja „Co szukam”).', kind: 'error' }
    return
  }
  promptBusy.value = mode
  message.value = null
  try {
    const current = parsed.value.kind === 'definition' ? parsed.value.value : undefined
    const result = await pricesApi.prompt({
      mode,
      url: props.source.url.trim(),
      shop: props.source.label.trim() || undefined,
      fetchMode: props.source.fetchMode,
      item: { name: props.item.name, description: props.item.description || null, ean: props.item.ean || null },
      sourceId: mode === 'repair' ? props.source.id : undefined,
      currentDefinition: mode === 'repair' ? current : undefined,
    })
    promptText.value = result.prompt
    const copied = await copy(result.prompt)
    const fetchInfo = result.fetchError
      ? ` Uwaga: strony nie udało się pobrać (${result.fetchError.message}) — prompt prosi AI, żeby otworzyło ją samo.`
      : result.snapshot
        ? ` Strona pobrana przez ${result.snapshot.fetcher}${result.snapshot.truncated ? ' (HTML przycięty)' : ''}.`
        : ''
    message.value = {
      text: `${copied ? 'Prompt skopiowany do schowka.' : 'Skopiuj prompt z pola poniżej.'} Wklej go agentowi AI, a odpowiedź wklej w pole „Definicja źródła”.${fetchInfo}`,
      kind: result.fetchError ? 'error' : 'ok',
    }
  } catch (err) {
    message.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    promptBusy.value = null
  }
}

async function copyHtml() {
  if (!canFetch()) return
  promptBusy.value = 'html'
  try {
    const snap = await pricesApi.snapshot({ url: props.source.url.trim(), fetchMode: props.source.fetchMode })
    const text = `${snap.jsonLd.length ? `JSON-LD:\n${snap.jsonLd.join('\n')}\n\n` : ''}HTML:\n${snap.html}`
    promptText.value = text
    const copied = await copy(text)
    message.value = { text: `${copied ? 'HTML skopiowany' : 'HTML poniżej'} (${Math.round(text.length / 1024)} KB, pobrany przez ${snap.fetcher}).`, kind: 'ok' }
  } catch (err) {
    message.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    promptBusy.value = null
  }
}

async function test() {
  if (!canFetch()) return
  const def = parsed.value
  if (def.kind === 'invalid' || def.kind === 'refusal') {
    message.value = { text: def.kind === 'invalid' ? def.message : 'Definicja to odpowiedź z błędem — popraw ją przed sprawdzeniem.', kind: 'error' }
    return
  }
  testing.value = true
  message.value = null
  props.source.test = null
  try {
    props.source.test = await pricesApi.testSource({
      url: props.source.url.trim(),
      fetchMode: props.source.fetchMode,
      definition: def.kind === 'definition' ? def.value : AUTO_DEFINITION,
    })
  } catch (err) {
    message.value = { text: (err as Error).message, kind: 'error' }
  } finally {
    testing.value = false
  }
}

function onPaste() {
  // Po wklejeniu odpowiedzi AI od razu sprawdź źródło.
  setTimeout(() => {
    const def = parseDefinition(props.source.definitionText)
    if (def.kind === 'definition') {
      props.source.definitionText = JSON.stringify(def.value, null, 2)
      if (!props.source.label.trim() && def.value.source?.shop) props.source.label = def.value.source.shop
      if (def.value.fetch?.mode && props.source.fetchMode === 'auto') props.source.fetchMode = def.value.fetch.mode as PriceFetchMode
      void test()
    }
  })
}

const fieldNames: Record<string, string> = { price: 'Cena', oldPrice: 'Stara cena', title: 'Tytuł', available: 'Dostępność' }
const show = (value: unknown, field: string) => {
  if (value === null || value === undefined) return '—'
  if (field === 'price' || field === 'oldPrice') return money(value as number)
  if (field === 'available') return value ? 'dostępny' : 'niedostępny'
  return String(value)
}
</script>

<template>
  <article class="pr-card source-card">
    <header class="card-head">
      <h3>Źródło {{ index + 1 }}<template v-if="source.label">: {{ source.label }}</template></h3>
      <div class="pr-actions">
        <span v-if="source.status" class="pr-badge" :class="source.status" :title="source.lastError ?? undefined">{{ STATUS_LABELS[source.status] }}</span>
        <button type="button" class="icon-button" :disabled="index === 0" aria-label="Przesuń wyżej" @click="emit('move', -1)">↑</button>
        <button type="button" class="icon-button" :disabled="index === count - 1" aria-label="Przesuń niżej" @click="emit('move', 1)">↓</button>
        <button type="button" class="icon-button" aria-label="Usuń źródło" @click="emit('remove')">✕</button>
      </div>
    </header>

    <p v-if="source.status && source.status !== 'ok' && source.lastError" class="pr-error-text">Ostatni błąd: {{ source.lastError }}</p>

    <div class="grid">
      <label class="field">
        <span>Sklep</span>
        <input v-model="source.label" type="text" placeholder="np. Media Expert" maxlength="100" :aria-invalid="!!fieldError('label')" />
        <small v-if="fieldError('label')" class="pr-error-text">{{ fieldError('label') }}</small>
      </label>
      <label class="field wide">
        <span>Link do produktu</span>
        <input v-model="source.url" type="url" placeholder="https://…" :aria-invalid="!!fieldError('url')" />
        <small v-if="fieldError('url')" class="pr-error-text">{{ fieldError('url') }}</small>
      </label>
      <label class="field wide">
        <span>Pobieranie strony</span>
        <select v-model="source.fetchMode">
          <option v-for="(label, value) in FETCH_MODE_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>

    <div class="pr-actions ai-buttons">
      <button type="button" class="button pr-small-button" :disabled="!!promptBusy" @click="copyPrompt('new')">
        {{ promptBusy === 'new' ? 'Pobieram stronę…' : 'Kopiuj prompt: nowe źródło' }}
      </button>
      <button v-if="source.id || parsed.kind === 'definition'" type="button" class="button pr-small-button" :disabled="!!promptBusy" @click="copyPrompt('repair')">
        {{ promptBusy === 'repair' ? 'Pobieram stronę…' : 'Kopiuj prompt: napraw źródło' }}
      </button>
      <button type="button" class="button ghost pr-small-button" :disabled="!!promptBusy" @click="copyHtml">
        {{ promptBusy === 'html' ? 'Pobieram…' : 'Kopiuj HTML strony' }}
      </button>
    </div>

    <details v-if="promptText" class="prompt-box">
      <summary>Pokaż skopiowany tekst ({{ Math.round(promptText.length / 1024) }} KB)</summary>
      <textarea readonly rows="6" :value="promptText" @focus="($event.target as HTMLTextAreaElement).select()" />
    </details>

    <label class="field">
      <span>Definicja źródła <em>odpowiedź AI w JSON; puste = automatycznie (dane strukturalne strony)</em></span>
      <textarea
        v-model="source.definitionText"
        class="code"
        rows="7"
        spellcheck="false"
        placeholder='{"version":1,"strategy":"auto", …}'
        :aria-invalid="parsed.kind === 'invalid' || definitionErrors.length > 0"
        @paste="onPaste"
      />
      <small v-if="parsed.kind === 'invalid'" class="pr-error-text">{{ parsed.message }}</small>
      <small v-else-if="parsed.kind === 'refusal'" class="pr-error-text">
        AI odmówiło ({{ parsed.code }}): {{ parsed.message }} {{ REFUSAL_HINTS[parsed.code] ?? '' }}
      </small>
      <small v-else-if="parsed.kind === 'definition'" class="pr-muted">
        Strategia: {{ parsed.value.strategy }}<template v-if="parsed.value.confidence"> · pewność: {{ parsed.value.confidence }}</template>
        <template v-if="parsed.value.notes"> · {{ parsed.value.notes }}</template>
      </small>
      <small v-for="err in definitionErrors" :key="err" class="pr-error-text">{{ err }}</small>
    </label>

    <div class="pr-actions">
      <button type="button" class="button primary pr-small-button" :disabled="testing" @click="test">
        {{ testing ? 'Sprawdzam… (do ~1 min)' : 'Sprawdź źródło' }}
      </button>
    </div>

    <p v-if="message" class="pr-notice" :class="message.kind" role="status">
      {{ message.text }}
      <button type="button" class="icon-button" aria-label="Ukryj" @click="message = null">✕</button>
    </p>

    <section v-if="source.test" class="result" :class="source.test.ok ? 'good' : 'bad'" aria-live="polite">
      <template v-if="source.test.ok && source.test.extraction">
        <p class="result-head">
          ✓ Działa · <strong>{{ money(source.test.extraction.price, source.test.extraction.currency) }}</strong>
          <template v-if="source.test.extraction.oldPrice"> (było {{ money(source.test.extraction.oldPrice) }})</template>
          · {{ source.test.extraction.available === false ? 'niedostępny' : source.test.extraction.available ? 'dostępny' : 'dostępność nieznana' }}
        </p>
        <p class="pr-muted">
          {{ source.test.extraction.title ?? 'brak tytułu' }} · źródło ceny: {{ source.test.extraction.strategyUsed }} · pobrane przez {{ source.test.fetcher }} (HTTP
          {{ source.test.httpStatus }}) w {{ (source.test.durationMs / 1000).toFixed(1) }} s
        </p>
      </template>
      <template v-else>
        <p class="result-head">✗ {{ source.test.error?.message ?? 'Nie działa' }}</p>
        <p v-if="source.test.error && ERROR_HINTS[source.test.error.code]" class="pr-muted">{{ ERROR_HINTS[source.test.error.code] }}</p>
        <p v-if="source.test.extraction?.title" class="pr-muted">Strona: {{ source.test.extraction.title }}</p>
      </template>

      <ul v-if="source.test.comparison.length" class="compare">
        <li v-for="c in source.test.comparison" :key="c.field" :class="c.ok ? 'ok' : 'no'">
          {{ c.ok ? '✓' : '✗' }} {{ fieldNames[c.field] }}: oczekiwano {{ show(c.expected, c.field) }}, jest {{ show(c.actual, c.field) }}
        </li>
      </ul>
      <ul v-if="source.test.selectorMatches.some((m) => m.count !== 1)" class="compare">
        <li v-for="m in source.test.selectorMatches.filter((m) => m.count !== 1)" :key="m.field" class="no">
          ✗ Selektor {{ m.field }} („{{ m.selector }}”) trafia w {{ m.count }} elementów zamiast 1
        </li>
      </ul>
      <ul v-if="source.test.extraction?.warnings.length" class="warnings pr-muted">
        <li v-for="w in source.test.extraction.warnings" :key="w">{{ w }}</li>
      </ul>
      <p v-if="source.test.attempts.length > 1" class="pr-muted">
        Próby:
        <template v-for="(a, i) in source.test.attempts" :key="i">
          {{ i ? ' → ' : '' }}{{ a.fetcher }} {{ a.ok ? '✓' : `✗ ${a.error?.message ?? ''}` }}
        </template>
      </p>
    </section>
  </article>
</template>

<style scoped>
.source-card {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.card-head h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 0.8rem;
}
.wide {
  grid-column: span 1;
}
.grid .field:last-child {
  grid-column: 1 / -1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
  min-width: 0;
}
.field > span em {
  font-style: normal;
  color: var(--muted);
  margin-left: 0.35rem;
}
.code {
  font-family: var(--font-code);
  font-size: 0.82rem;
}
.prompt-box textarea {
  margin-top: 0.4rem;
  font-family: var(--font-code);
  font-size: 0.78rem;
}
.prompt-box summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.88rem;
}
.result {
  padding: 0.75rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--line);
}
.result.good {
  border-color: rgb(92 200 164 / 0.5);
  background: rgb(92 200 164 / 0.07);
}
.result.bad {
  border-color: rgb(240 119 106 / 0.5);
  background: rgb(240 119 106 / 0.07);
}
.result p {
  margin: 0 0 0.3rem;
}
.result-head {
  font-weight: 600;
}
.compare,
.warnings {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
}
.compare .ok {
  color: var(--ok);
}
.compare .no {
  color: var(--fail);
}
@media (max-width: 40rem) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
