<script setup lang="ts">
import { computed } from 'vue'
import type { ModuleResult, RadarModuleInfo } from '@myorg/shared'
import { relativeTime } from '../lib/format'
import type { SectionState } from './useDashboard'

// Frame of one dashboard section: heading, sources, freshness, refresh, and every state
// (loading, request error, all sources failed, some failed, nothing to show).

const props = defineProps<{ section: SectionState; modules: Map<string, RadarModuleInfo>; now: number }>()
const emit = defineEmits<{ refresh: [] }>()

const loaded = computed(() => props.section.results.filter((r): r is ModuleResult => r !== null))
const ok = computed(() => loaded.value.filter((r) => r.status !== 'error'))
const failed = computed(() => loaded.value.filter((r) => r.status === 'error'))
/** Source down, last good data shown instead (stale-if-error) — say so, with the time of the data. */
const staleNotes = computed(() => ok.value.filter((r) => r.stale).map((r) => r.warnings[0]).filter(Boolean))
const hasData = computed(() => ok.value.some((r) => r.data.length > 0))
/** Source names; many sources → just the count. */
const sources = computed(() => {
  const names = new Set(loaded.value.map((r) => r.source.name))
  return names.size > 4 ? `${names.size} źródeł` : [...names].join(', ')
})
const attributions = computed(() => [...new Set(ok.value.map((r) => r.source.attribution).filter(Boolean))])
/** The oldest successful fetch — that is how stale the section can be. */
const fetchedAt = computed(() => ok.value.map((r) => r.fetchedAt).sort()[0] ?? null)
const moduleName = (id: string) => props.modules.get(id)?.name ?? id
</script>

<template>
  <section :id="`radar-${section.id}`" class="section" :aria-labelledby="`radar-${section.id}-title`" :aria-busy="section.loading">
    <header class="head">
      <div class="titles">
        <h2 :id="`radar-${section.id}-title`">{{ section.title }}</h2>
        <p class="meta">
          <span v-if="sources">{{ sources }}</span>
          <span v-if="section.loading" class="status">pobieranie…</span>
          <span v-else-if="fetchedAt" class="status">pobrano {{ relativeTime(fetchedAt, now) }}</span>
        </p>
      </div>
      <button
        type="button"
        class="icon-button refresh"
        :class="{ spinning: section.loading }"
        :disabled="section.loading"
        :aria-label="`Odśwież sekcję ${section.title}`"
        title="Odśwież"
        @click="emit('refresh')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" /></svg>
      </button>
    </header>

    <p v-if="section.error" class="state error" role="alert">
      Nie udało się pobrać sekcji: {{ section.error }}
      <button type="button" class="button ghost small" @click="emit('refresh')">Spróbuj ponownie</button>
    </p>

    <p v-else-if="!loaded.length && section.loading" class="state muted">Pobieranie danych ze źródeł…</p>

    <div v-else-if="loaded.length && !ok.length" class="state error" role="alert">
      <p>Żadne źródło tej sekcji nie odpowiedziało.</p>
      <ul>
        <li v-for="r in failed" :key="r.moduleId">{{ moduleName(r.moduleId) }}: {{ r.error?.message }}</li>
      </ul>
      <button type="button" class="button ghost small" :disabled="section.loading" @click="emit('refresh')">Spróbuj ponownie</button>
    </div>

    <template v-else-if="ok.length">
      <p v-for="note in staleNotes" :key="note" class="state partial">{{ note }}</p>
      <p v-if="failed.length" class="state partial">
        Niedostępne: {{ failed.map((r) => `${moduleName(r.moduleId)} (${r.error?.message})`).join('; ') }}.
        Pozostałe źródła działają.
      </p>
      <slot v-if="hasData" :results="ok" />
      <p v-else class="state muted">Źródła nie mają teraz nic nowego.</p>
      <p v-if="attributions.length" class="attribution">{{ attributions.join(' ') }}</p>
    </template>
  </section>
</template>

<style scoped>
.section {
  /* Clears the sticky tab bar when jumping to a section. */
  scroll-margin-top: calc(var(--tabs-offset, 0px) + 1rem);
  padding: 2rem 0 0.5rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--line);
}
.titles {
  min-width: 0;
}
h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
  line-height: 1.1;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.9rem;
  margin: 0.3rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.status {
  white-space: nowrap;
}
.refresh {
  display: inline-grid;
  flex: none;
  place-items: center;
}
.refresh svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.refresh:disabled {
  cursor: progress;
}
.spinning svg {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.state {
  margin: 1rem 0;
}
.state p,
.state ul {
  margin: 0 0 0.6rem;
}
.state ul {
  padding-left: 1.1rem;
  font-size: 0.9rem;
}
.error {
  color: var(--fail);
}
.partial {
  padding: 0.55rem 0.8rem;
  border-left: 3px solid var(--signal);
  background: rgb(242 181 68 / 0.08);
  color: var(--ink);
  font-size: 0.9rem;
}
.small {
  margin-left: 0.5rem;
  padding: 0.3rem 0.7rem;
  font-size: 0.85rem;
}
.attribution {
  margin: 0.75rem 0 0;
  color: var(--muted);
  font-size: 0.78rem;
}
@media (prefers-reduced-motion: reduce) {
  .spinning svg {
    animation: none;
  }
}
</style>
