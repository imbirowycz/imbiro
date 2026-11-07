import { computed, reactive, ref } from 'vue'
import type { DashboardPage, ModuleResult, RadarModuleInfo } from '@myorg/shared'
import { ApiRequestError } from '../api/client'
import { radarApi } from '../api/radar'
import { setReadKeys } from './read-items'
import { setReaderDomains } from './reader'

// State of one dashboard page (Home, Weather & finance). Every section loads, fails and refreshes on its own:
// one slow or broken source never blocks the others. Nothing is stored beyond this page.

export interface SectionState {
  id: string
  title: string
  moduleIds: string[]
  results: (ModuleResult | null)[]
  loading: boolean
  /** Request-level failure (network, 5xx). Module failures live in `results[i].error`. */
  error: string | null
}

const AUTO_REFRESH_MS = 10 * 60_000

/** The server no longer knows a module of the layout held by this tab (a source was removed in a deploy). */
const isStaleLayout = (err: unknown) =>
  err instanceof ApiRequestError && err.status === 400 && err.details.some((d) => d.message === 'Unknown module')

export function useDashboard(page: DashboardPage) {
  const sections = ref<SectionState[]>([])
  const modules = ref(new Map<string, RadarModuleInfo>())
  const layoutLoading = ref(true)
  const layoutError = ref<string | null>(null)
  // Ignore responses that arrive after a newer refresh of the same section.
  const requestIds = new Map<string, number>()

  let reloadingLayout = false

  const loadingAny = computed(() => sections.value.some((s) => s.loading))

  async function refresh(id: string, force = false): Promise<void> {
    const section = sections.value.find((s) => s.id === id)
    if (!section) return
    const requestId = (requestIds.get(id) ?? 0) + 1
    requestIds.set(id, requestId)
    section.loading = true
    section.error = null
    try {
      const run = await radarApi.runModules(section.moduleIds, force)
      if (requestIds.get(id) !== requestId) return
      const byId = new Map(run.results.map((r) => [r.moduleId, r]))
      section.results = section.moduleIds.map((moduleId) => byId.get(moduleId) ?? null)
    } catch (err) {
      if (requestIds.get(id) !== requestId) return
      // The page stays alive between deploys: fetch the current layout once and refresh again.
      if (isStaleLayout(err) && !reloadingLayout) {
        reloadingLayout = true
        try {
          if (await loadLayout({ quiet: true })) return void (await refreshAll(force))
        } finally {
          reloadingLayout = false
        }
      }
      section.error = (err as Error).message
    } finally {
      if (requestIds.get(id) === requestId) section.loading = false
    }
  }

  /** Parallel, but each section settles independently. */
  function refreshAll(force = false): Promise<void> {
    return Promise.allSettled(sections.value.map((s) => refresh(s.id, force))).then(() => undefined)
  }

  /**
   * Layout + cached results only (instant). Returns false when it failed.
   * quiet: the page stays on screen (no loading state, a failure is left to the caller).
   */
  async function loadLayout({ quiet = false } = {}): Promise<boolean> {
    if (!quiet) {
      layoutLoading.value = true
      layoutError.value = null
    }
    try {
      const [layout, catalog] = await Promise.all([radarApi.dashboard(), radarApi.listModules()])
      modules.value = new Map(catalog.map((m) => [m.id, m]))
      setReaderDomains(layout.readerDomains)
      setReadKeys(layout.readKeys)
      sections.value = layout.sections.filter((s) => s.page === page).map((s) => reactive({ ...s, loading: false, error: null }))
      return true
    } catch (err) {
      if (!quiet) layoutError.value = (err as Error).message
      return false
    } finally {
      if (!quiet) layoutLoading.value = false
    }
  }

  /**
   * Cached results render immediately; then every section asks for fresh data
   * (the server still answers from its cache when the data is fresh enough).
   */
  async function load(): Promise<void> {
    if (await loadLayout()) await refreshAll(false)
  }

  let timer: ReturnType<typeof setInterval> | undefined
  function startAutoRefresh() {
    stopAutoRefresh()
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll(false)
    }, AUTO_REFRESH_MS)
  }
  function stopAutoRefresh() {
    if (timer) clearInterval(timer)
  }

  return { sections, modules, layoutLoading, layoutError, loadingAny, load, loadLayout, refresh, refreshAll, startAutoRefresh, stopAutoRefresh }
}
