<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ArticleView } from '@myorg/shared'
import { radarApi } from '../api/radar'
import { markNewsRead } from './read-items'

// Reader mode: one article, fetched on demand, shown as plain readable text.
// The HTML comes from the server already sanitized (structure and links only); the page CSP
// additionally forbids inline scripts, so v-html cannot execute anything.

const route = useRoute()
const router = useRouter()

const article = ref<ArticleView | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const url = computed(() => (typeof route.query.url === 'string' ? route.query.url : ''))

/** The URL comes from the address bar — only http(s) ever becomes a link (no javascript:, data:…). */
function safeHref(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}
const originalHref = computed(() => safeHref(article.value?.url) ?? safeHref(url.value))
const published = computed(() =>
  article.value?.publishedAt
    ? new Date(article.value.publishedAt).toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null
)

/** Set while leaving for the original article (reader mode could not prepare the text). */
const redirecting = ref(false)

/**
 * Clicking a news item opens reader mode first; when it fails, go straight to the original.
 * `replace` drops this page from history, so Back returns to the dashboard, not to an error.
 * Without a usable URL the error/fallback view below stays on screen.
 */
function openOriginal(): boolean {
  const href = originalHref.value
  if (!href) return false
  redirecting.value = true
  window.location.replace(href)
  return true
}

async function load() {
  article.value = null
  error.value = null
  redirecting.value = false
  if (!url.value) {
    error.value = 'Brak adresu artykułu.'
    return
  }
  loading.value = true
  try {
    article.value = await radarApi.readArticle(url.value)
    if (article.value.status !== 'success') {
      openOriginal()
      return
    }
    if (article.value.title) document.title = `${article.value.title} – imbiro`
  } catch (err) {
    error.value = (err as Error).message
    openOriginal()
  } finally {
    loading.value = false
  }
}
watch(url, load, { immediate: true })

/** Back to where the user came from (the dashboard keeps its scroll position), or to Home. */
function goBack() {
  if (window.history.state?.back) router.back()
  else void router.push('/')
}

/** Hide this news on the dashboard for good and go back to it (where "Undo" is shown). */
function markAsReadAndBack() {
  if (!url.value) return
  void markNewsRead({ url: url.value, title: article.value?.title ?? url.value, source: article.value?.source ?? null })
  goBack()
}
</script>

<template>
  <div class="reader">
    <nav class="bar" aria-label="Nawigacja czytnika">
      <button type="button" class="back" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        Wróć
      </button>
      <div v-if="article?.status === 'success'" class="actions">
        <button type="button" class="mark-read" @click="markAsReadAndBack">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Przeczytane
        </button>
        <a v-if="originalHref" class="original" :href="originalHref" target="_blank" rel="noopener noreferrer">
          Otwórz oryginał
        </a>
      </div>
    </nav>

    <p v-if="loading" class="state muted" role="status">Pobieranie i oczyszczanie artykułu…</p>

    <p v-else-if="redirecting" class="state muted" role="status">
      Nie udało się przygotować wersji do czytania — otwieram oryginał…
    </p>

    <div v-else-if="error" class="state error" role="alert">
      <p>Nie udało się otworzyć artykułu: {{ error }}</p>
      <button type="button" class="button" @click="load">Spróbuj ponownie</button>
    </div>

    <div v-else-if="article && article.status !== 'success'" class="state">
      <h1 v-if="article.title" class="title">{{ article.title }}</h1>
      <p class="message">{{ article.message }}</p>
      <p v-if="article.excerpt" class="excerpt">{{ article.excerpt }}</p>
      <a v-if="originalHref" class="button primary" :href="originalHref" target="_blank" rel="noopener noreferrer">
        Otwórz na stronie {{ article.source }}
      </a>
    </div>

    <article v-else-if="article" :aria-labelledby="'reader-title'">
      <header class="head">
        <p class="source">{{ article.source }}</p>
        <h1 id="reader-title" class="title">{{ article.title }}</h1>
        <p class="meta">
          <span v-if="article.author">{{ article.author }}</span>
          <span v-if="published">{{ published }}</span>
          <span>{{ article.readingMinutes }} min czytania</span>
        </p>
      </header>
      <!-- eslint-disable-next-line vue/no-v-html -- sanitized on the server, scripts blocked by CSP -->
      <div class="prose" v-html="article.html" />
      <footer class="foot">
        <p>
          Tekst pobrany ze strony {{ article.source }} w trybie czytania, bez reklam i elementów strony.
          Nie jest nigdzie zapisywany.
        </p>
        <a v-if="originalHref" :href="originalHref" target="_blank" rel="noopener noreferrer">Przeczytaj na stronie źródła</a>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.reader {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1rem 1rem 5rem;
}
/* Stays at the top while reading, so Back and the original are always one tap away. */
.bar {
  position: sticky;
  top: var(--bar-top, 0px);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: -1rem -1rem 1.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--line);
  background: var(--night);
}
@media (max-width: 52rem) {
  /* Below the sticky mobile bar of the app shell. */
  .reader {
    --bar-top: 3.25rem;
  }
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.4rem 0.6rem 0.4rem 0.2rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.back:hover {
  color: var(--ink);
  background: var(--panel);
}
.back svg {
  width: 1.2rem;
  height: 1.2rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.mark-read {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.75rem 0.35rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.mark-read:hover {
  border-color: var(--ok);
  color: var(--ok);
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
.original {
  color: var(--signal);
  font-size: 0.9rem;
  text-decoration: none;
}
.original:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.head {
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--line);
}
.source {
  margin: 0 0 0.5rem;
  color: var(--signal);
  font-weight: 500;
}
.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.9rem, 4vw, 2.6rem);
  font-weight: 600;
  line-height: 1.12;
  text-wrap: balance;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.1rem;
  margin: 0.9rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}

/* ---- Article text: the one place in the app set for long reading ---- */
.prose {
  max-width: 38rem;
  padding-top: 1.75rem;
  color: #dfe5ef;
  font-family: var(--font-reading);
  font-size: 1.15rem;
  line-height: 1.72;
  font-optical-sizing: auto;
  overflow-wrap: break-word;
  hyphens: auto;
}
.prose :deep(p) {
  margin: 0 0 1.15em;
}
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4),
.prose :deep(h5),
.prose :deep(h6) {
  margin: 1.8em 0 0.6em;
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1.2;
}
.prose :deep(h2) {
  font-size: 1.5rem;
}
.prose :deep(h3) {
  font-size: 1.28rem;
}
.prose :deep(h4),
.prose :deep(h5),
.prose :deep(h6) {
  font-size: 1.1rem;
}
.prose :deep(a) {
  color: var(--signal);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.prose :deep(blockquote) {
  margin: 1.4em 0;
  padding: 0.1em 0 0.1em 1.1em;
  border-left: 3px solid var(--signal);
  color: var(--ink);
  font-style: italic;
}
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0 0 1.15em;
  padding-left: 1.3em;
}
.prose :deep(li) {
  margin-bottom: 0.35em;
}
.prose :deep(pre) {
  margin: 0 0 1.2em;
  padding: 0.9rem 1rem;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--panel);
  font-size: 0.88rem;
  line-height: 1.5;
}
.prose :deep(code) {
  font-family: var(--font-code);
  font-size: 0.88em;
}
.prose :deep(:not(pre) > code) {
  padding: 0.1em 0.3em;
  border-radius: 4px;
  background: var(--panel);
}
.prose :deep(table) {
  display: block;
  max-width: 100%;
  margin: 0 0 1.2em;
  overflow-x: auto;
  border-collapse: collapse;
  font-family: var(--font-body);
  font-size: 0.92rem;
}
.prose :deep(th),
.prose :deep(td) {
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.prose :deep(hr) {
  margin: 2em 0;
  border: 0;
  border-top: 1px solid var(--line);
}
.foot {
  max-width: 38rem;
  margin-top: 2.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.88rem;
}
.foot p {
  margin: 0 0 0.6rem;
}
.foot a {
  color: var(--signal);
}

.state {
  padding: 1rem 0;
}
.state .title {
  margin-bottom: 1rem;
}
.message {
  margin: 0 0 1rem;
  font-size: 1.05rem;
}
.excerpt {
  margin: 0 0 1.5rem;
  padding-left: 1rem;
  border-left: 3px solid var(--line);
  color: var(--muted);
  font-family: var(--font-reading);
  font-size: 1.05rem;
  line-height: 1.6;
}
.error {
  color: var(--fail);
}
a.button {
  display: inline-block;
  text-decoration: none;
}
@media (max-width: 30rem) {
  .prose {
    font-size: 1.07rem;
    line-height: 1.68;
  }
}
</style>
