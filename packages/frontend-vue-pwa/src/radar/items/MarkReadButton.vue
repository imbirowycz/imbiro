<script setup lang="ts">
// Round "read — don't show again" button used by news and alert lists;
// `all`: the section-wide variant (double tick) in the section header.
withDefaults(defineProps<{ label: string; all?: boolean }>(), { all: false })
</script>

<template>
  <button
    type="button"
    class="mark-read"
    :class="{ all }"
    :aria-label="label"
    :title="all ? 'Oznacz wszystko jako przeczytane' : 'Przeczytane — nie pokazuj więcej'"
  >
    <svg v-if="all" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12.5l4.5 4.5L16.5 7.5M11 16l1 1L21.5 7.5" /></svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  </button>
</template>

<style scoped>
.mark-read {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: none;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
}
/* Same size as the section's refresh button next to it. */
.mark-read.all {
  width: 2.25rem;
  height: 2.25rem;
}
.mark-read.all svg {
  width: 1.15rem;
  height: 1.15rem;
}
.mark-read:hover {
  border-color: var(--ok);
  background: rgb(92 200 164 / 0.12);
  color: var(--ok);
}
.mark-read:focus-visible {
  outline: 2px solid var(--ok);
  outline-offset: 2px;
}
.mark-read svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
