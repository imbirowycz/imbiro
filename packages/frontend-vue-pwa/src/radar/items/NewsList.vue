<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NewsItem } from '@myorg/shared'
import { shortWhen } from '../format'
import type { NewsOrder } from '../news-order'
import { canRead } from '../reader'

// The order is chosen in the section header (NewsOrderToggle) and passed in.
const props = withDefaults(
  defineProps<{ items: NewsItem[]; limit?: number; heading?: string; order?: NewsOrder; showSummary?: boolean }>(),
  { limit: 8, heading: undefined, order: 'latest', showSummary: true }
)

const expanded = ref(false)

/** Same story from two feeds (e.g. RMF Polska and RMF Warszawa) is shown once. */
const unique = computed(() => {
  const seen = new Set<string>()
  return props.items.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)))
})

const sorted = computed(() =>
  [...unique.value].sort((a, b) =>
    props.order === 'relevant' && b.relevance.score !== a.relevance.score
      ? b.relevance.score - a.relevance.score
      : (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
  )
)
const visible = computed(() => (expanded.value ? sorted.value : sorted.value.slice(0, props.limit)))
const now = new Date()
</script>

<template>
  <div class="news">
    <h3 v-if="heading">{{ heading }}</h3>

    <ol class="rows">
      <li v-for="item in visible" :key="item.url" class="row">
        <div class="body">
          <time v-if="item.publishedAt" class="when" :datetime="item.publishedAt">{{ shortWhen(item.publishedAt, now) }}</time>
          <!-- Reader mode first (it falls back to the original by itself); unsupported sites open directly. -->
          <RouterLink v-if="canRead(item.url)" class="title" :to="{ name: 'read', query: { url: item.url } }">
            {{ item.title }}
          </RouterLink>
          <a v-else class="title" :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
          <p v-if="showSummary && item.summary" class="summary">{{ item.summary }}</p>
          <p class="meta">
            <span>{{ item.source }}</span>
            <span v-if="item.relevance.matches.length" class="matches">{{ item.relevance.matches.join(', ') }}</span>
          </p>
          <a
            v-if="canRead(item.url)"
            class="original"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="`Otwórz oryginał: ${item.title}`"
          >
            Oryginał
          </a>
        </div>
      </li>
    </ol>

    <button v-if="sorted.length > limit" type="button" class="more" @click="expanded = !expanded">
      {{ expanded ? 'Pokaż mniej' : `Pokaż wszystkie (${sorted.length})` }}
    </button>
  </div>
</template>

<style scoped>
h3 {
  margin: 1rem 0 0.25rem;
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
}
/* Time sits on its own line above the title. */
.when {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 0.9rem;
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
/* Own line under the meta, aligned with the rest of the column. */
.original {
  display: inline-block;
  margin-top: 0.2rem;
  color: var(--muted);
  font-size: 0.8rem;
  text-decoration: none;
}
.original:hover {
  color: var(--signal);
  text-decoration: underline;
  text-underline-offset: 3px;
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

</style>
