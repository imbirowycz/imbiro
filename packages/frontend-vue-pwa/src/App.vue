<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AuthSessionInfo } from '@myorg/shared'
import { authApi } from './api/auth'
import { setUnauthorizedHandler } from './api/client'
import LoginForm from './components/LoginForm.vue'
import SchedulerPage from './components/SchedulerPage.vue'

// Brama logowania. To tylko wygoda interfejsu — dostęp do danych pilnuje API (401 bez sesji).
const session = ref<AuthSessionInfo | null>(null)
const checking = ref(true)
const loginNotice = ref<string | null>(null)
const startError = ref<string | null>(null)

setUnauthorizedHandler(() => {
  if (!session.value) return
  session.value = null
  loginNotice.value = 'Sesja wygasła. Zaloguj się ponownie.'
})

async function logout() {
  try {
    await authApi.logout()
  } finally {
    session.value = null
    loginNotice.value = 'Wylogowano.'
  }
}

onMounted(async () => {
  try {
    session.value = await authApi.me()
  } catch (err) {
    startError.value = (err as Error).message
  } finally {
    checking.value = false
  }
})
</script>

<template>
  <p v-if="checking" class="boot muted">Ładowanie…</p>
  <p v-else-if="startError && !session" class="boot load-error">{{ startError }}</p>
  <SchedulerPage v-else-if="session" :user="session.user" @logout="logout" />
  <LoginForm v-else :notice="loginNotice" @logged-in="session = $event; loginNotice = null" />
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
.boot {
  padding: 2rem 1rem;
  text-align: center;
}
.load-error {
  color: var(--fail);
}
</style>
