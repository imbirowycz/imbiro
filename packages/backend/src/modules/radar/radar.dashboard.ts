import type { DashboardLayout, DashboardSection } from '@myorg/shared'
import type { ModuleRegistry } from './core/module.registry'
import { MAX_MODULES_PER_RUN, type ModuleRunner } from './core/module.runner'

// Layout of the Home dashboard: which modules feed which section. Kept on the server so the
// frontend never hard-codes module ids. Each section is loaded and refreshed independently.

interface SectionDefinition {
  id: string
  title: string
  /** Modules shown in the section, in order. Groups are expanded at startup. */
  modules: { group?: string; module?: string }[]
}

const SECTIONS: SectionDefinition[] = [
  { id: 'weather', title: 'Pogoda', modules: [{ group: 'weather' }] },
  // Only rates and gold — economy news are not shown on the dashboard.
  { id: 'finance', title: 'Finanse', modules: [{ group: 'finance' }] },
  { id: 'poland', title: 'Polska', modules: [{ group: 'news.poland' }] },
  { id: 'world', title: 'Świat', modules: [{ group: 'news.world' }] },
  { id: 'warsaw', title: 'Warszawa', modules: [{ group: 'news.warsaw' }] },
  { id: 'it', title: 'IT', modules: [{ group: 'news.security' }] },
  { id: 'alerts', title: 'Alerty', modules: [{ group: 'alerts' }] },
]

export function buildDashboardSections(registry: ModuleRegistry): DashboardSection[] {
  return SECTIONS.map((section) => {
    const moduleIds = [
      ...new Set(section.modules.flatMap((ref) => (ref.group ? registry.getGroup(ref.group).moduleIds : [ref.module!]))),
    ].map((id) => registry.get(id).id)
    // The frontend refreshes a section with one POST /run, which accepts at most MAX_MODULES_PER_RUN ids.
    // Fail at startup instead of a section silently answering 400 after someone adds feeds.
    if (moduleIds.length > MAX_MODULES_PER_RUN) {
      throw new Error(`Dashboard section "${section.id}" has ${moduleIds.length} modules (max ${MAX_MODULES_PER_RUN}) — split it`)
    }
    return { id: section.id, title: section.title, moduleIds }
  })
}

/**
 * Layout plus whatever is already in the cache — returns immediately, never contacts a source.
 * The frontend renders this at once and then refreshes each section on its own.
 */
export function dashboardSnapshot(sections: DashboardSection[], runner: ModuleRunner, readerDomains: string[]): DashboardLayout {
  return {
    generatedAt: new Date().toISOString(),
    readerDomains,
    sections: sections.map((section) => ({
      ...section,
      results: section.moduleIds.map((id) => runner.peek(id)),
    })),
  }
}
