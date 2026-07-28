<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateUserDTO, User } from '@myorg/shared'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

const users = ref<User[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const form = ref<CreateUserDTO>({ email: '', password: '', name: '' })
const submitting = ref(false)

async function loadUsers() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`${apiBase}/api/users`)
    if (!res.ok) throw new Error(await res.text())
    users.value = await res.json()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load users'
  } finally {
    loading.value = false
  }
}

async function onSubmit() {
  submitting.value = true
  error.value = null
  try {
    const res = await fetch(`${apiBase}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? res.statusText)
    }
    const newUser = await res.json()
    users.value.push(newUser)
    form.value = { email: '', password: '', name: '' }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create user'
  } finally {
    submitting.value = false
  }
}

onMounted(loadUsers)
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>My App - imbiro</h1>
      <p class="lede">Vue 3 + PWA · API na Express + Postgres</p>
    </header>

    <section class="card">
      <h2>Nowy użytkownik</h2>
      <form class="form" @submit.prevent="onSubmit">
        <label>
          Email
          <input v-model="form.email" type="email" required autocomplete="email" />
        </label>
        <label>
          Hasło
          <input
            v-model="form.password"
            type="password"
            required
            autocomplete="new-password"
          />
        </label>
        <label>
          Imię
          <input v-model="form.name" type="text" required autocomplete="name" />
        </label>
        <button type="submit" :disabled="submitting">
          {{ submitting ? 'Zapisywanie…' : 'Utwórz' }}
        </button>
      </form>
    </section>

    <section class="card">
      <h2>Użytkownicy</h2>
      <p v-if="loading" class="muted">Ładowanie…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <ul v-else-if="users.length" class="list">
        <li v-for="u in users" :key="u.id">
          <span class="name">{{ u.name }}</span>
          <span class="email">{{ u.email }}</span>
        </li>
      </ul>
      <p v-else class="muted">Brak użytkowników — dodaj pierwszego powyżej.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #e8e8ef;
  min-height: 100vh;
  box-sizing: border-box;
  background: linear-gradient(165deg, #12121a 0%, #1a1a2e 45%, #16213e 100%);
}

.header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.lede {
  margin: 0;
  color: #9b9bb8;
  font-size: 0.95rem;
}

.card {
  margin-top: 1.75rem;
  padding: 1.25rem 1.35rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.card h2 {
  margin: 0 0 1rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.form label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #b4b4cc;
}

.form input {
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: #f0f0f8;
  font-size: 0.95rem;
}

.form input:focus {
  outline: 2px solid #6c63ff;
  outline-offset: 1px;
}

.form button {
  margin-top: 0.25rem;
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 8px;
  background: #6c63ff;
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
}

.form button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.muted {
  margin: 0;
  color: #8a8aa3;
  font-size: 0.9rem;
}

.error {
  margin: 0;
  color: #ff8a8a;
  font-size: 0.9rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.list li {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.name {
  font-weight: 600;
}

.email {
  font-size: 0.85rem;
  color: #9b9bb8;
}
</style>
