<script setup lang="ts">
import type { NewsOrder } from './news-order'

// Segmented switch shown in a section header; it orders every news list in that section.
const order = defineModel<NewsOrder>({ required: true })
</script>

<template>
  <div class="order" role="group" aria-label="Kolejność wiadomości">
    <button type="button" :aria-pressed="order === 'latest'" @click="order = 'latest'">Najnowsze</button>
    <button type="button" :aria-pressed="order === 'relevant'" @click="order = 'relevant'">Najważniejsze</button>
  </div>
</template>

<style scoped>
.order {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
button {
  padding: 0.25rem 0.65rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.82rem;
  white-space: nowrap;
  cursor: pointer;
}
button:hover {
  color: var(--ink);
}
button[aria-pressed='true'] {
  background: var(--panel);
  color: var(--ink);
}
</style>
