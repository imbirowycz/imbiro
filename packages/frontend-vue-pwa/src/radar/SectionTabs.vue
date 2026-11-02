<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ tabs: { id: string; title: string; loading: boolean; failed: boolean }[]; active: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()

const list = ref<HTMLElement | null>(null)

// Keep the active tab visible when the strip is wider than the screen.
watch(
  () => props.active,
  async (id) => {
    await nextTick()
    const el = list.value?.querySelector<HTMLElement>(`[data-tab="${id}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
)
</script>

<template>
  <nav class="tabs" aria-label="Sekcje dashboardu">
    <ul ref="list">
      <li v-for="tab in tabs" :key="tab.id">
        <a
          :href="`#radar-${tab.id}`"
          :data-tab="tab.id"
          :aria-current="tab.id === active ? 'location' : undefined"
          @click.prevent="emit('select', tab.id)"
        >
          {{ tab.title }}
          <span v-if="tab.failed && !tab.loading" class="dot" title="Część źródeł niedostępna" aria-label="(część źródeł niedostępna)" />
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.tabs {
  position: sticky;
  top: var(--tabs-top, 0px);
  z-index: 10;
  margin: 0 -1rem;
  padding: 0 1rem;
  border-bottom: 1px solid var(--line);
  background: var(--night);
}
ul {
  display: flex;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  list-style: none;
  scrollbar-width: none;
}
ul::-webkit-scrollbar {
  display: none;
}
a {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.85rem 0.8rem 0.75rem;
  color: var(--muted);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
a:hover {
  color: var(--ink);
}
/* Underline marker in the signal colour, like the scheduler's selected-row bar. */
a[aria-current='location'] {
  color: var(--ink);
  box-shadow: inset 0 -3px 0 var(--signal);
}
.dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--fail);
}
</style>
