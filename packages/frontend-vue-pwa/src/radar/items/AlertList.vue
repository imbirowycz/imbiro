<script setup lang="ts">
import type { AirQualityStation, AlertItem } from '@myorg/shared'
import { computed } from 'vue'
import { dateTime, number, SEVERITY_LABEL, shortWhen } from '../format'
import { isAlertRead, markAlertRead } from '../read-items'
import MarkReadButton from './MarkReadButton.vue'

const props = defineProps<{ alerts: AlertItem[]; air: AirQualityStation[]; heading?: boolean }>()
const now = new Date()

/** Alerts marked as read are hidden (a re-issued version has a new key and shows again). */
const visible = computed(() => props.alerts.filter((a) => !isAlertRead(a)))
const allRead = computed(() => props.alerts.length > 0 && visible.value.length === 0)
</script>

<template>
  <div class="alerts">
    <div v-if="alerts.length" class="block">
      <h3 v-if="heading">Ostrzeżenia i komunikaty</h3>
      <ul class="list">
        <li v-for="a in visible" :key="a.id" class="alert" :class="a.severity">
          <span class="marker" aria-hidden="true" />
          <div>
            <p class="title">
              <a v-if="a.url" :href="a.url" target="_blank" rel="noopener noreferrer">{{ a.title }}</a>
              <template v-else>{{ a.title }}</template>
            </p>
            <p class="meta">
              <span>{{ SEVERITY_LABEL[a.severity] }}</span>
              <span>{{ a.source }}</span>
              <span v-if="a.expiresAt">do {{ dateTime(a.expiresAt) }}</span>
              <span v-else-if="a.issuedAt">{{ shortWhen(a.issuedAt, now) }}</span>
            </p>
            <details v-if="a.description" class="more">
              <summary>Szczegóły</summary>
              <p>{{ a.description }}</p>
            </details>
          </div>
          <MarkReadButton :label="`Oznacz jako przeczytane: ${a.title}`" @click="markAlertRead(a)" />
        </li>
      </ul>
      <p v-if="allRead" class="all-read">Wszystko przeczytane.</p>
    </div>

    <div v-if="air.length" class="block">
      <h3>Jakość powietrza</h3>
      <table class="air">
        <thead>
          <tr><th scope="col">Stacja</th><th scope="col">Indeks</th><th scope="col">PM10 / PM2.5 / NO₂ (µg/m³)</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in air" :key="s.stationId" :class="s.severity">
            <th scope="row">{{ s.name }}</th>
            <td class="index"><span class="marker" aria-hidden="true" />{{ s.indexCategory ?? 'brak indeksu' }}</td>
            <td class="values">
              {{
                ['PM10', 'PM2.5', 'NO2']
                  .map((code) => s.pollutants.find((p) => p.code === code)?.value)
                  .map((v) => (v === null || v === undefined ? '–' : number(v, 0)))
                  .join(' / ')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.alerts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
  gap: 0 2.5rem;
  align-items: start;
}
h3 {
  margin: 1rem 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.alert {
  display: grid;
  grid-template-columns: 0.75rem minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.75rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--line);
}
/* Severity marker: yellow / orange / red follow the IMGW scale; info is neutral. */
.marker {
  display: inline-block;
  width: 0.65rem;
  height: 0.65rem;
  margin-top: 0.4rem;
  border-radius: 50%;
  background: var(--muted);
}
.low .marker {
  background: var(--signal);
}
.medium .marker {
  background: var(--warn);
}
.high .marker {
  background: var(--fail);
}
.title {
  margin: 0;
  font-weight: 500;
}
.title a {
  color: var(--ink);
  text-decoration: none;
}
.title a:hover {
  color: var(--signal);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.9rem;
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.all-read {
  margin: 0.75rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.more summary {
  margin-top: 0.3rem;
  color: var(--muted);
  font-size: 0.85rem;
  cursor: pointer;
}
.more p {
  margin: 0.4rem 0 0;
  font-size: 0.9rem;
}
.air {
  width: 100%;
  border-collapse: collapse;
}
.air thead th {
  padding: 0 0 0.4rem;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 500;
  text-align: left;
}
.air tbody th,
.air td {
  padding: 0.5rem 0.75rem 0.5rem 0;
  border-bottom: 1px solid var(--line);
  font-size: 0.9rem;
  text-align: left;
}
.air tbody th {
  font-weight: 400;
}
.index {
  white-space: nowrap;
}
.index .marker {
  margin: 0 0.45rem 0 0;
  vertical-align: 0.05rem;
}
.info .index .marker {
  background: var(--ok);
}
.values {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
