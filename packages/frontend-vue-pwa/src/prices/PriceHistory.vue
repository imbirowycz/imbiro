<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PriceObservation } from '@myorg/shared'
import { pricesApi } from '../api/prices'
import { money, shortDate } from './format'

const props = defineProps<{ sourceId: string }>()

const rows = ref<PriceObservation[] | null>(null)
const error = ref<string | null>(null)

async function load() {
  if (rows.value) return
  try {
    rows.value = await pricesApi.history(props.sourceId)
  } catch (err) {
    error.value = (err as Error).message
  }
}

const W = 600
const H = 120
const PAD = 6

/** Linia ceny w czasie (tylko udane pomiary), od najstarszego. */
const chart = computed(() => {
  const points = (rows.value ?? []).filter((r) => r.ok && r.price !== null).reverse()
  if (points.length < 2) return null
  const times = points.map((p) => new Date(p.checkedAt).getTime())
  const prices = points.map((p) => p.price as number)
  const [t0, t1] = [Math.min(...times), Math.max(...times)]
  const [min, max] = [Math.min(...prices), Math.max(...prices)]
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD)
  const y = (p: number) => (max === min ? H / 2 : PAD + (1 - (p - min) / (max - min)) * (H - 2 * PAD))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.price as number).toFixed(1)}`).join(' ')
  const lowIndex = prices.indexOf(min)
  return { path, min, max, low: { x: x(times[lowIndex]), y: y(min) }, from: points[0].checkedAt, to: points[points.length - 1].checkedAt }
})
</script>

<template>
  <details class="history" @toggle="($event.target as HTMLDetailsElement).open && load()">
    <summary>Historia cen</summary>
    <p v-if="error" class="pr-error-text">{{ error }}</p>
    <p v-else-if="!rows" class="pr-muted">Ładowanie…</p>
    <p v-else-if="!rows.length" class="pr-muted">Brak pomiarów — źródło nie było jeszcze sprawdzane.</p>
    <template v-else>
      <figure v-if="chart" class="chart">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="`Cena od ${money(chart.min)} do ${money(chart.max)}`">
          <path :d="chart.path" class="line" vector-effect="non-scaling-stroke" />
          <circle :cx="chart.low.x" :cy="chart.low.y" r="4" class="low" />
        </svg>
        <figcaption class="pr-muted">
          {{ shortDate(chart.from) }} – {{ shortDate(chart.to) }} · najniżej {{ money(chart.min) }} · najwyżej {{ money(chart.max) }}
        </figcaption>
      </figure>
      <ul class="rows">
        <li v-for="row in rows.slice(0, 10)" :key="row.id" :class="{ failed: !row.ok }">
          <span>{{ shortDate(row.checkedAt) }}</span>
          <span v-if="row.ok">{{ money(row.price) }}<template v-if="row.oldPrice"> (było {{ money(row.oldPrice) }})</template>{{ row.available === false ? ' · niedostępny' : '' }}</span>
          <span v-else class="pr-error-text">{{ row.errorCode }}: {{ row.error }}</span>
          <span class="pr-muted">{{ row.fetcher ?? '' }}</span>
        </li>
      </ul>
    </template>
  </details>
</template>

<style scoped>
.history summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.88rem;
}
.chart {
  margin: 0.6rem 0;
}
.chart svg {
  display: block;
  width: 100%;
  height: 7.5rem;
  border-bottom: 1px solid var(--line);
}
.line {
  fill: none;
  stroke: var(--signal);
  stroke-width: 2;
}
.low {
  fill: var(--ok);
}
.rows {
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}
.rows li {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr) auto;
  gap: 0.6rem;
  padding: 0.2rem 0;
  border-top: 1px solid var(--line);
}
</style>
