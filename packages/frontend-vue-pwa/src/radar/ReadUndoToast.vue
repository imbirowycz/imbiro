<script setup lang="ts">
import { dismissReadToast, readToast, undoRead } from './read-items'

// "Marked as read · Undo" after hiding a news item (or the error when saving failed).
</script>

<template>
  <div class="toast-region" aria-live="polite">
    <div v-if="readToast" class="toast" :class="{ failed: readToast.error }" role="status">
      <p class="text">
        <template v-if="readToast.error">{{ readToast.error }}</template>
        <template v-else>
          Oznaczono jako przeczytane: <span class="title">{{ readToast.title }}</span>
        </template>
      </p>
      <button v-if="!readToast.error" type="button" class="undo" @click="undoRead(readToast.keys)">Cofnij</button>
      <button type="button" class="close" aria-label="Zamknij" @click="dismissReadToast">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  right: 0;
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  left: 0;
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 0 1rem;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: min(100%, 34rem);
  padding: 0.6rem 0.6rem 0.6rem 1rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
  pointer-events: auto;
}
.toast.failed {
  border-color: var(--fail);
}
.text {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.failed .text {
  color: var(--fail);
  white-space: normal;
}
.title {
  color: var(--muted);
}
.undo {
  flex: none;
  padding: 0.35rem 0.75rem;
  border: 0;
  border-radius: 6px;
  background: #2f7bf5;
  color: #fff;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.undo:hover {
  background: #4a8ef7;
}
.close {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.close:hover {
  color: var(--ink);
}
.close svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
</style>
