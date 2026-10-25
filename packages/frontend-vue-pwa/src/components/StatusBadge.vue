<script setup lang="ts">
import type { ExecutionStatus } from '@myorg/shared'
import { STATUS_LABELS } from '../lib/format'

defineProps<{ status: ExecutionStatus }>()
</script>

<template>
  <span class="badge" :class="status">{{ STATUS_LABELS[status] }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  white-space: nowrap;
}
.badge::before {
  content: '';
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: currentColor;
}
.pending {
  color: var(--muted);
}
.running {
  color: var(--signal);
}
.running::before {
  animation: pulse 1.2s ease-in-out infinite;
}
.succeeded {
  color: var(--ok);
}
.failed {
  color: var(--fail);
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .running::before {
    animation: none;
  }
}
</style>
