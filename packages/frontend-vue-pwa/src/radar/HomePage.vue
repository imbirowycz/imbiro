<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { longToday } from './format'
import RadarSection from './RadarSection.vue'
import SectionBody from './SectionBody.vue'
import SectionTabs from './SectionTabs.vue'
import { useDashboard } from './useDashboard'

const route = useRoute()
const router = useRouter()
const { sections, modules, layoutLoading, layoutError, loadingAny, load, loadLayout, refresh, refreshAll, startAutoRefresh, stopAutoRefresh } =
  useDashboard()

const now = ref(Date.now())
const activeId = ref<string | null>(null)

const tabs = computed(() =>
  sections.value.map((s) => ({
    id: s.id,
    title: s.title,
    loading: s.loading,
    failed: !!s.error || s.results.some((r) => r?.status === 'error'),
  }))
)

// ---- Scroll spy: the tab follows the section currently near the top of the screen ----

let observer: IntersectionObserver | undefined
/** While a click-triggered smooth scroll runs, the observer must not fight the clicked tab. */
let lockedUntil = 0
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function observeSections() {
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      if (Date.now() < lockedUntil) return
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) activeId.value = visible[0].target.id.replace(/^radar-/, '')
    },
    // A band in the upper part of the viewport, below the sticky tabs.
    { rootMargin: '-15% 0px -70% 0px' }
  )
  for (const s of sections.value) {
    const el = document.getElementById(`radar-${s.id}`)
    if (el) observer.observe(el)
  }
}

function scrollTo(id: string, smooth = true) {
  const el = document.getElementById(`radar-${id}`)
  if (!el) return
  activeId.value = id
  lockedUntil = Date.now() + 900
  el.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' })
  // The address reflects the section, so it can be bookmarked or shared.
  void router.replace({ hash: `#${id}` })
}

// ---- Lifecycle ----

let clock: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  clock = setInterval(() => (now.value = Date.now()), 30_000)
  startAutoRefresh()
  const initialHash = route.hash.replace(/^#/, '')
  // Layout with cached data first (instant), so the page can jump to a section right away…
  if (!(await loadLayout())) return
  await nextTick()
  if (initialHash && sections.value.some((s) => s.id === initialHash)) scrollTo(initialHash, false)
  else activeId.value = sections.value[0]?.id ?? null
  // …then every section refreshes on its own.
  await refreshAll(false)
})

onBeforeUnmount(() => {
  clearInterval(clock)
  stopAutoRefresh()
  observer?.disconnect()
})

// Section elements appear when the layout loads (also after a retry) → observe them.
watch(
  () => sections.value.length,
  async () => {
    await nextTick()
    observeSections()
  }
)

async function retryLayout() {
  await load()
}
</script>

<template>
  <div class="home">
    <header class="top">
      <div>
        <h1>Radar</h1>
        <p class="lede">{{ longToday(new Date(now)) }}</p>
      </div>
      <button type="button" class="button" :disabled="loadingAny || layoutLoading" @click="refreshAll(true)">
        {{ loadingAny ? 'Odświeżanie…' : 'Odśwież wszystko' }}
      </button>
    </header>

    <p v-if="layoutLoading" class="muted">Ładowanie dashboardu…</p>
    <div v-else-if="layoutError" class="layout-error" role="alert">
      <p>Nie udało się wczytać dashboardu: {{ layoutError }}</p>
      <button type="button" class="button" @click="retryLayout">Spróbuj ponownie</button>
    </div>

    <template v-else>
      <SectionTabs :tabs="tabs" :active="activeId" @select="scrollTo" />
      <RadarSection
        v-for="section in sections"
        :key="section.id"
        :section="section"
        :modules="modules"
        :now="now"
        @refresh="refresh(section.id, true)"
      >
        <template #default="{ results }">
          <SectionBody :results="results" />
        </template>
      </RadarSection>
    </template>
  </div>
</template>

<style scoped>
.home {
  --tabs-top: 0px;
  --tabs-offset: calc(var(--tabs-top) + 3rem);
  max-width: 76rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 4rem;
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
}
h1 {
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
.lede::first-letter {
  text-transform: uppercase;
}
.layout-error {
  color: var(--fail);
}
@media (max-width: 52rem) {
  /* Below the sticky mobile bar of the app shell. */
  .home {
    --tabs-top: 3.25rem;
  }
}
@media (max-width: 30rem) {
  h1 {
    font-size: 1.9rem;
  }
}
</style>
