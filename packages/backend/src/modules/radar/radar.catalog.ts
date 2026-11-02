import { ModuleRegistry } from './core/module.registry'
import { ModuleRunner } from './core/module.runner'
import { radarConfig } from './radar.config'
import { createNbpCurrenciesModule, createNbpGoldModule } from './sources/finance/nbp.modules'

// The single, explicit list of radar modules and groups.
// New module = new file with a factory + one `.register(...)` line here (and a group entry).
// Built at import time; a misconfiguration (duplicate id, unknown group member, cycle) stops startup.

export function createRadarRegistry(): ModuleRegistry {
  return new ModuleRegistry()
    .register(createNbpCurrenciesModule(radarConfig.finance.currencies))
    .register(createNbpGoldModule())
    .defineGroup({
      id: 'finance',
      name: 'Finanse',
      description: 'Kursy walut i cena złota z NBP',
      moduleIds: ['finance.nbp.currencies', 'finance.nbp.gold'],
    })
    .validate()
}

/** One registry and one runner (with its in-memory cache) per process: API and Worker each have their own. */
export const radarRegistry = createRadarRegistry()
export const radarRunner = new ModuleRunner(radarRegistry)
