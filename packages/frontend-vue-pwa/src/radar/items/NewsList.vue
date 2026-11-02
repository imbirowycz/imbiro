<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NewsItem } from '@myorg/shared'
import { shortWhen } from '../format'

const props = withDefaults(
  defineProps<{ items: NewsItem[]; limit?: number; heading?: string; sortable?: boolean; showSummary?: boolean }>(),
  { limit: 8, heading: undefined, sortable: true, showSummary: true }
)

type Order = 'latest' | 'relevant'
const order = ref<Order>('latest')
const expanded = ref(false)

/** Same story from two feeds (e.g. RMF Polska and RMF Warszawa) is shown once. */
const unique = computed(() => {
  const seen = new Set<string>()
  return props.items.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)))
})

const sorted = computed(() =>
  [...unique.value].sort((a, b) =>
    order.value === 'relevant' && b.relevance.score !== a.relevance.score
      ? b.relevance.score - a.relevance.score
      : (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
  )
)
const visible = computed(() => (expanded.value ? sorted.value : sorted.value.slice(0, props.limit)))
const now = new Date()
</script>

<template>
  <div class="news">
    <div v-if="heading || sortable" class="bar">
      <h3 v-if="heading">{{ heading }}</h3>
      <div v-if="sortable" class="order" role="group" aria-label="Kolejność wiadomości">
        <button type="button" :aria-pressed="order === 'latest'" @click="order = 'latest'">Najnowsze</button>
        <button type="button" :aria-pressed="order === 'relevant'" @click="order = 'relevant'">Najważniejsze</button>
      </div>
    </div>

    <ol class="rows">
      <li v-for="item in visible" :key="item.url" class="row">
        <span class="when">{{ item.publishedAt ? shortWhen(item.publishedAt, now) : '' }}</span>
        <div class="body">
          <a class="title" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
          <p v-if="showSummary && item.summary" class="summary">{{ item.summary }}</p>
          <p class="meta">
            <span>{{ item.source }}</span>
            <span v-if="item.relevance.matches.length" class="matches">{{ item.relevance.matches.join(', ') }}</span>
          </p>
        </div>
      </li>
    </ol>

    <button v-if="sorted.length > limit" type="button" class="more" @click="expanded = !expanded">
      {{ expanded ? 'Pokaż mniej' : `Pokaż wszystkie (${sorted.length})` }}
    </button>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin: 1rem 0 0.25rem;
}
h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
}
.order {
  display: inline-flex;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.order button {
  padding: 0.25rem 0.65rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.order button[aria-pressed='true'] {
  background: var(--panel);
  color: var(--ink);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: grid;
  grid-template-columns: 4.75rem minmax(0, 1fr);
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
}
.when {
  padding-top: 0.1rem;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.body {
  max-width: 46rem;
}
.title {
  color: var(--ink);
  font-weight: 500;
  line-height: 1.35;
  text-decoration: none;
}
.title:hover {
  color: var(--signal);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.title:visited {
  color: #b9c3d6;
}
.summary {
  display: -webkit-box;
  margin: 0.25rem 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.9rem;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.9rem;
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.matches {
  color: var(--signal);
}
.more {
  margin-top: 0.6rem;
  padding: 0.4rem 0;
  border: 0;
  background: none;
  color: var(--signal);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.more:hover {
  text-decoration: underline;
}
@media (max-width: 30rem) {
  .row {
    grid-template-columns: 3.6rem minmax(0, 1fr);
    gap: 0.6rem;
  }
  .when {
    font-size: 0.85rem;
  }
}
</style>
