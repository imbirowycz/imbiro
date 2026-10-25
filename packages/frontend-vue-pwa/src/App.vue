<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ScheduledTask, TaskExecution } from '@myorg/shared'
import { schedulerApi, type ActionInfo } from './api/scheduler'
import TaskBoard from './components/TaskBoard.vue'
import TaskDetail from './components/TaskDetail.vue'
import TaskForm from './components/TaskForm.vue'

const POLL_MS = 5000

const tasks = ref<ScheduledTask[]>([])
const actions = ref<ActionInfo[]>([])
const executions = ref<TaskExecution[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const notice = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const busy = ref(false)
const form = ref<{ task: ScheduledTask | null } | null>(null)
const now = ref(Date.now())

const selected = computed(() => tasks.value.find((t) => t.id === selectedId.value) ?? null)

async function loadTasks() {
  try {
    tasks.value = await schedulerApi.listTasks()
    loadError.value = null
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function loadExecutions() {
  if (!selectedId.value) return
  const id = selectedId.value
  try {
    const list = await schedulerApi.listExecutions(id)
    if (selectedId.value === id) executions.value = list
  } catch {
    // Błąd odświeżania historii nie przerywa pracy; kolejna próba za chwilę.
  }
}

function say(text: string, kind: 'ok' | 'error' = 'ok') {
  notice.value = { text, kind }
}

async function perform(action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
  } catch (err) {
    say((err as Error).message, 'error')
  } finally {
    busy.value = false
  }
}

function replaceTask(task: ScheduledTask) {
  const index = tasks.value.findIndex((t) => t.id === task.id)
  if (index === -1) tasks.value.push(task)
  else tasks.value[index] = task
}

function runSelected() {
  const task = selected.value
  if (!task) return
  void perform(async () => {
    await schedulerApi.runTask(task.id)
    say(`Uruchomiono „${task.title}”. Wynik pojawi się w historii.`)
    await loadExecutions()
  })
}

function toggleSelected() {
  const task = selected.value
  if (!task) return
  void perform(async () => {
    const updated = task.enabled ? await schedulerApi.disableTask(task.id) : await schedulerApi.enableTask(task.id)
    replaceTask(updated)
    say(updated.enabled ? `Włączono „${updated.title}”.` : `Wyłączono „${updated.title}”.`)
  })
}

function onSaved(task: ScheduledTask) {
  const isNew = !form.value?.task
  replaceTask(task)
  form.value = null
  selectedId.value = task.id
  say(isNew ? `Utworzono „${task.title}”.` : `Zapisano zmiany w „${task.title}”.`)
}

// Wybrane zadanie w adresie (#/<id>) — przetrwa odświeżenie i daje link do zadania.
const selectedFromHash = () => location.hash.replace(/^#\/?/, '') || null
selectedId.value = selectedFromHash()

watch(selectedId, (id) => {
  executions.value = []
  void loadExecutions()
  const hash = id ? `#/${id}` : ''
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname)
})

let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  now.value = Date.now()
  if (document.visibilityState !== 'visible') return
  void loadTasks()
  void loadExecutions()
}

onMounted(async () => {
  schedulerApi.listActions().then((list) => (actions.value = list)).catch(() => {})
  await loadTasks()
  void loadExecutions()
  timer = setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', tick)
})
</script>

<template>
  <div class="shell" :class="{ 'has-selection': !!selected }">
    <header class="top">
      <div>
        <h1>imbiro</h1>
        <p class="lede">Zadania uruchamiane według harmonogramu</p>
      </div>
      <button type="button" class="button primary" @click="form = { task: null }">Nowe zadanie</button>
    </header>

    <p v-if="notice" class="notice" :class="notice.kind" role="status">
      {{ notice.text }}
      <button type="button" class="icon-button" aria-label="Ukryj komunikat" @click="notice = null">✕</button>
    </p>

    <main class="layout">
      <section class="list-pane" aria-label="Zadania">
        <p v-if="loading" class="muted">Ładowanie zadań…</p>
        <p v-else-if="loadError && !tasks.length" class="load-error">{{ loadError }}</p>
        <div v-else-if="!tasks.length" class="empty">
          <h2>Nic nie jest jeszcze zaplanowane</h2>
          <p>Dodaj zadanie: wybierz akcję, na przykład raport albo wiadomość na Telegramie, i ustal, kiedy ma się wykonywać.</p>
          <button type="button" class="button primary" @click="form = { task: null }">Dodaj pierwsze zadanie</button>
        </div>
        <TaskBoard v-else :tasks="tasks" :selected-id="selectedId" :now="now" @select="selectedId = $event" />
      </section>

      <section class="detail-pane" aria-label="Szczegóły zadania">
        <TaskDetail
          v-if="selected"
          :task="selected"
          :executions="executions"
          :busy="busy"
          :now="now"
          @run="runSelected"
          @toggle="toggleSelected"
          @edit="form = { task: selected }"
          @back="selectedId = null"
        />
        <p v-else-if="tasks.length" class="muted pick">Wybierz zadanie z listy, żeby zobaczyć szczegóły i historię uruchomień.</p>
      </section>
    </main>

    <TaskForm v-if="form" :task="form.task" :actions="actions" @saved="onSaved" @close="form = null" />
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600&display=swap');

:root {
  --night: #0f1a2e;
  --panel: #172540;
  --line: #2a3b5c;
  --ink: #e6ecf5;
  --muted: #8e9bb3;
  --signal: #f2b544;
  --ok: #5cc8a4;
  --fail: #f0776a;
  --font-display: 'Barlow Semi Condensed', 'Arial Narrow', system-ui, sans-serif;
  --font-body: 'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-code: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--night);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

input,
select,
textarea {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--night);
  color: var(--ink);
  font: inherit;
}
textarea {
  resize: vertical;
}
input[aria-invalid='true'],
select[aria-invalid='true'],
textarea[aria-invalid='true'] {
  border-color: var(--fail);
}
:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}

.button {
  padding: 0.55rem 1rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.button:hover:not(:disabled) {
  border-color: var(--muted);
}
.button.primary {
  border-color: var(--signal);
  background: var(--signal);
  color: var(--night);
  font-weight: 600;
}
.button.primary:hover:not(:disabled) {
  background: #f6c565;
}
.button.ghost {
  background: none;
}
.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.icon-button {
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}
.icon-button:hover {
  color: var(--ink);
}
.muted {
  color: var(--muted);
}
</style>

<style scoped>
.shell {
  max-width: 76rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
}
.top > div {
  min-width: 0;
}
.top h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 600;
  line-height: 1;
}
.lede {
  margin: 0.35rem 0 0;
  color: var(--muted);
}
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 0 1rem;
  padding: 0.5rem 0.5rem 0.5rem 0.9rem;
  border-radius: 8px;
  background: rgb(92 200 164 / 0.12);
  color: var(--ok);
}
.notice.error {
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 2.5rem;
  align-items: start;
}
.detail-pane {
  position: sticky;
  top: 1.5rem;
}
.empty {
  padding: 2rem 0;
  max-width: 34rem;
}
.empty h2 {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
}
.empty p {
  margin: 0 0 1.25rem;
  color: var(--muted);
}
.load-error {
  color: var(--fail);
}
.pick {
  padding-top: 1rem;
}
@media (max-width: 56rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-pane {
    position: static;
  }
  .pick {
    display: none;
  }
  .has-selection .list-pane {
    display: none;
  }
}
@media (max-width: 30rem) {
  .top h1 {
    font-size: 1.9rem;
  }
}
</style>
