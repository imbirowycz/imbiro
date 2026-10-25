<script setup lang="ts">
import { ref } from 'vue'
import type { AuthSessionInfo } from '@myorg/shared'
import { authApi } from '../api/auth'
import { ApiRequestError } from '../api/client'

defineProps<{ notice?: string | null }>()
const emit = defineEmits<{ loggedIn: [session: AuthSessionInfo] }>()

const login = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

function minutes(seconds: number): string {
  const m = Math.ceil(seconds / 60)
  return m === 1 ? '1 minutę' : m < 5 ? `${m} minuty` : `${m} minut`
}

async function submit() {
  submitting.value = true
  error.value = null
  try {
    const session = await authApi.login({ login: login.value, password: password.value })
    password.value = ''
    emit('loggedIn', session)
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      error.value = 'Nieprawidłowy login lub hasło.'
    } else if (err instanceof ApiRequestError && err.status === 429) {
      error.value = `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${minutes(err.retryAfterSeconds ?? 900)}.`
    } else if (err instanceof ApiRequestError && err.status === 400) {
      error.value = 'Podaj login i hasło.'
    } else {
      error.value = (err as Error).message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="card" novalidate @submit.prevent="submit">
      <h1>imbiro</h1>
      <p class="lede">Zaloguj się, żeby zarządzać zadaniami.</p>

      <p v-if="notice && !error" class="notice" role="status">{{ notice }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <label class="field">
        <span>Login lub e-mail</span>
        <input v-model="login" type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus />
      </label>
      <label class="field">
        <span>Hasło</span>
        <input v-model="password" type="password" name="password" autocomplete="current-password" required />
      </label>

      <button type="submit" class="button primary" :disabled="submitting || !login || !password">
        {{ submitting ? 'Logowanie…' : 'Zaloguj się' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 1.5rem 1rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(24rem, 100%);
}
h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.75rem;
  font-weight: 600;
  line-height: 1;
  color: var(--signal);
}
.lede {
  margin: -0.25rem 0 0.5rem;
  color: var(--muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.button {
  margin-top: 0.5rem;
  padding: 0.7rem 1rem;
}
.error,
.notice {
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: 8px;
}
.error {
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.notice {
  background: var(--panel);
  color: var(--muted);
}
</style>
