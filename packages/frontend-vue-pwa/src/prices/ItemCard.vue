<script setup lang="ts">
import type { PriceItem } from '@myorg/shared'
import { relativeTime } from '../lib/format'
import { money, scheduleLabel } from './format'

// One tracked item on the page. A click on the card opens the popup with details.

defineProps<{ item: PriceItem; now: number; busy: boolean }>()
const emit = defineEmits<{ open: []; edit: []; toggle: []; remove: [] }>()
</script>

<template>
  <article class="card" :class="{ off: !item.enabled, hit: item.summary.targetReached }">
    <button type="button" class="main" :aria-label="`Szczegóły: ${item.name}`" @click="emit('open')">
      <span class="name">
        {{ item.name }}
        <span v-if="item.summary.targetReached" class="tag hit">cena osiągnięta</span>
        <span v-if="!item.enabled" class="tag">śledzenie wyłączone</span>
      </span>
      <span class="price">
        <template v-if="item.summary.bestPrice !== null">
          <strong>{{ money(item.summary.bestPrice, item.summary.currency) }}</strong>
          <span class="muted">najniżej w {{ item.summary.bestSourceLabel }}</span>
        </template>
        <span v-else class="muted">brak ceny — czeka na pierwsze sprawdzenie</span>
      </span>
      <span class="facts">
        <span v-if="item.targetPrice !== null">cena minimalna: {{ money(item.targetPrice) }}</span>
        <span :class="{ problem: item.summary.problemSources > 0 }">
          źródła: {{ item.summary.okSources }}/{{ item.sources.filter((s) => s.enabled).length }} OK
        </span>
        <span>{{ scheduleLabel(item.schedule) }}</span>
        <span v-if="item.summary.lastCheckedAt">sprawdzono {{ relativeTime(item.summary.lastCheckedAt, now) }}</span>
      </span>
    </button>
    <div class="actions">
      <button type="button" class="button ghost" :disabled="busy" @click="emit('edit')">Edytuj</button>
      <button type="button" class="button ghost" :disabled="busy" @click="emit('toggle')">{{ item.enabled ? 'Wyłącz śledzenie' : 'Włącz śledzenie' }}</button>
      <button type="button" class="button ghost danger" :disabled="busy" @click="emit('remove')">Usuń</button>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
}
.card.hit {
  box-shadow: inset 3px 0 0 var(--ok);
}
.card.off {
  opacity: 0.7;
}
.main {
  display: flex;
  flex: 1 1 20rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.2;
}
.main:hover .name {
  color: var(--signal);
}
.tag {
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
}
.tag.hit {
  border-color: var(--ok);
  color: var(--ok);
}
.price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}
.price strong {
  color: var(--signal);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 1rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.problem {
  color: var(--warn);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.actions .button {
  padding: 0.4rem 0.75rem;
  font-size: 0.9rem;
}
.danger:hover:not(:disabled) {
  border-color: var(--fail);
  color: var(--fail);
}
</style>
