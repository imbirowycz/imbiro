<script setup lang="ts">
import type { ScheduledTask, TaskExecution } from '@myorg/shared'
import { actionLabel, clockTime, dateTime, dayLabel, duration, idleLabel, relativeTime, scheduleLabel } from '../lib/format'
import StatusBadge from './StatusBadge.vue'

defineProps<{
  task: ScheduledTask
  executions: TaskExecution[]
  busy: boolean
  now: number
}>()
const emit = defineEmits<{ edit: []; toggle: []; run: []; back: [] }>()

// Krótki opis wyniku dla znanych kształtów; pozostałe jako JSON (pełny w podpowiedzi).
function resultPreview(execution: TaskExecution): string {
  if (execution.error) return execution.error
  const result = execution.result as Record<string, unknown> | null
  if (!result) return ''
  const totals = result.totals as { succeeded: number; failed: number; inProgress: number } | undefined
  if (totals) return `raport: ${totals.succeeded} udanych, ${totals.failed} z błędem, ${totals.inProgress} w toku`
  if (Array.isArray(result.accepted)) return `wysłano do ${(result.accepted as string[]).join(', ')}`
  if (result.messageId !== undefined) return `wysłano, wiadomość ${String(result.messageId)}`
  return JSON.stringify(result)
}
</script>

<template>
  <article class="detail" aria-labelledby="task-title">
    <button type="button" class="back" @click="emit('back')">Wszystkie zadania</button>

    <header class="head">
      <h2 id="task-title">{{ task.title }}</h2>
      <p v-if="task.description" class="description">{{ task.description }}</p>
    </header>

    <div class="next">
      <template v-if="task.nextRunAt">
        <span class="next-time">{{ clockTime(task.nextRunAt) }}</span>
        <span class="next-label">najbliższe uruchomienie: {{ dayLabel(task.nextRunAt, new Date(now)) }}, {{ relativeTime(task.nextRunAt, now) }}</span>
      </template>
      <span v-else class="next-label">Brak zaplanowanych uruchomień: zadanie {{ idleLabel(task) }}.</span>
    </div>

    <dl class="facts">
      <div>
        <dt>Akcja</dt>
        <dd>{{ actionLabel(task.actionType) }} <code>{{ task.actionType }}</code></dd>
      </div>
      <div>
        <dt>Harmonogram</dt>
        <dd>{{ scheduleLabel(task) }}</dd>
      </div>
      <div v-if="task.scheduleType !== 'once'">
        <dt>Okres</dt>
        <dd>od {{ dateTime(task.startAt) }}{{ task.endAt ? `, do ${dateTime(task.endAt)}` : ', bez końca' }}</dd>
      </div>
    </dl>

    <div class="actions">
      <button type="button" class="button primary" :disabled="busy" @click="emit('run')">Uruchom teraz</button>
      <button type="button" class="button" :disabled="busy" @click="emit('toggle')">
        {{ task.enabled ? 'Wyłącz' : 'Włącz' }}
      </button>
      <button type="button" class="button ghost" @click="emit('edit')">Edytuj</button>
    </div>

    <section class="history" aria-labelledby="history-title">
      <h3 id="history-title">Historia uruchomień</h3>
      <p v-if="!executions.length" class="empty">
        To zadanie jeszcze się nie wykonało. Użyj „Uruchom teraz”, żeby sprawdzić akcję bez czekania na termin.
      </p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Termin</th>
              <th scope="col">Status</th>
              <th scope="col">Próby</th>
              <th scope="col">Czas</th>
              <th scope="col">Wynik</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in executions" :key="e.id">
              <td>
                {{ dateTime(e.scheduledFor) }}
                <span v-if="e.trigger === 'manual'" class="manual">ręcznie</span>
              </td>
              <td><StatusBadge :status="e.status" /></td>
              <td class="num">{{ e.attempts }}</td>
              <td class="num">{{ duration(e.startedAt, e.finishedAt) }}</td>
              <td class="result" :class="{ failed: !!e.error }" :title="e.error ?? JSON.stringify(e.result)">{{ resultPreview(e) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </article>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}
.back {
  display: none;
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--signal);
  font: inherit;
  cursor: pointer;
}
.back::before {
  content: '‹ ';
}
.head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.9rem;
  font-weight: 600;
  line-height: 1.15;
}
.description {
  margin: 0.5rem 0 0;
  color: var(--muted);
  max-width: 60ch;
}
.next {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}
.next-time {
  font-family: var(--font-display);
  font-size: 4.5rem;
  font-weight: 600;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  color: var(--signal);
}
.next-label {
  color: var(--muted);
}
.facts {
  display: grid;
  gap: 0.6rem;
  margin: 0;
}
.facts div {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 1rem;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
code {
  font-family: var(--font-code);
  font-size: 0.85em;
  color: var(--muted);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.history h3 {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
}
.empty {
  margin: 0;
  color: var(--muted);
  max-width: 60ch;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  padding: 0 0.75rem 0.5rem 0;
  border-bottom: 1px solid var(--line);
}
td {
  padding: 0.6rem 0.75rem 0.6rem 0;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  white-space: nowrap;
}
.num {
  font-variant-numeric: tabular-nums;
}
.manual {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
}
.result {
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}
.result.failed {
  color: var(--fail);
  white-space: normal;
}
@media (max-width: 56rem) {
  .back {
    display: inline;
  }
}
@media (max-width: 30rem) {
  .next-time {
    font-size: 3.5rem;
  }
  .facts div {
    grid-template-columns: 1fr;
    gap: 0.1rem;
  }
}
</style>
