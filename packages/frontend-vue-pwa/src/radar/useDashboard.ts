import { computed, reactive, ref } from 'vue'
import type { ModuleResult, RadarModuleInfo } from '@myorg/shared'
import { radarApi } from '../api/radar'
import { setReaderDomains } from './reader'

// State of the Home dashboard. Every section loads, fails and refreshes on its own:
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

export function useDashboard() {
  const sections = ref<SectionState[]>([])
  const modules = ref(new Map<string, RadarModuleInfo>())
  const layoutLoading = ref(true)
  const layoutError = ref<string | null>(null)
  // Ignore responses that arrive after a newer refresh of the same section.
  const requestIds = new Map<string, number>()

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
      if (requestIds.get(id) === requestId) section.error = (err as Error).message
    } finally {
      if (requestIds.get(id) === requestId) section.loading = false
    }
  }

  /** Parallel, but each section settles independently. */
  function refreshAll(force = false): Promise<void> {
    return Promise.allSettled(sections.value.map((s) => refresh(s.id, force))).then(() => undefined)
  }

  /** Layout + cached results only (instant). Returns false when it failed. */
  async function loadLayout(): Promise<boolean> {
    layoutLoading.value = true
    layoutError.value = null
    try {
      const [layout, catalog] = await Promise.all([radarApi.dashboard(), radarApi.listModules()])
      modules.value = new Map(catalog.map((m) => [m.id, m]))
      setReaderDomains(layout.readerDomains)
      sections.value = layout.sections.map((s) => reactive({ ...s, loading: false, error: null }))
      return true
    } catch (err) {
      layoutError.value = (err as Error).message
      return false
    } finally {
      layoutLoading.value = false
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
