<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduledTask } from '@myorg/shared'
import { actionLabel, clockTime, dayLabel, idleLabel, relativeTime, scheduleLabel } from '../lib/format'

const props = defineProps<{ tasks: ScheduledTask[]; selectedId: string | null; now: number }>()
const emit = defineEmits<{ select: [id: string] }>()

// Jak na tablicy odjazdów: najbliższe terminy na górze, zadania bez terminu na końcu.
const ordered = computed(() =>
  [...props.tasks].sort((a, b) => {
    if (a.nextRunAt && b.nextRunAt) return a.nextRunAt.localeCompare(b.nextRunAt)
    if (a.nextRunAt) return -1
    if (b.nextRunAt) return 1
    return a.title.localeCompare(b.title, 'pl')
  })
)
</script>

<template>
  <ol class="board" aria-label="Zadania według najbliższego terminu">
    <li v-for="task in ordered" :key="task.id">
      <button
        type="button"
        class="row"
        :class="{ selected: task.id === selectedId, idle: !task.nextRunAt }"
        :aria-current="task.id === selectedId ? 'true' : undefined"
        @click="emit('select', task.id)"
      >
        <span class="when">
          <template v-if="task.nextRunAt">
            <span class="time">{{ clockTime(task.nextRunAt) }}</span>
            <span class="day">{{ dayLabel(task.nextRunAt, new Date(now)) }}</span>
          </template>
          <span v-else class="time idle-time">{{ idleLabel(task) }}</span>
        </span>
        <span class="what">
          <span class="title">{{ task.title }}</span>
          <span class="meta">{{ actionLabel(task.actionType) }}, {{ scheduleLabel(task) }}</span>
        </span>
        <span v-if="task.nextRunAt" class="eta">{{ relativeTime(task.nextRunAt, now) }}</span>
      </button>
    </li>
  </ol>
</template>

<style scoped>
.board {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}
.row {
  display: grid;
  grid-template-columns: 6.5rem 1fr auto;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 0.9rem 0.75rem;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--panel);
}
.row.selected {
  background: var(--panel);
  box-shadow: inset 3px 0 0 var(--signal);
}
.when {
  display: flex;
  flex-direction: column;
}
.time {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--signal);
}
.time.idle-time {
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--muted);
}
.day {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.what {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 0.85rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.idle .title {
  color: var(--muted);
}
.eta {
  font-size: 0.85rem;
  color: var(--muted);
  white-space: nowrap;
}
@media (max-width: 30rem) {
  .row {
    grid-template-columns: 5.25rem 1fr;
  }
  .time {
    font-size: 1.6rem;
  }
  .eta {
    display: none;
  }
}
</style>
