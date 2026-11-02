import type { RadarGroupInfo, RadarModuleInfo, RunTarget } from '@myorg/shared'
import type { RadarModule } from './module.types'

// Central catalog of radar modules and groups. Populated explicitly in radar.catalog.ts
// (no dynamic imports), so the API and the Worker always see the same set of modules.

const ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
const GROUP_ID_RE = /^[a-z][a-z0-9_.]*$/

export class UnknownTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ModuleRegistry {
  private readonly modules = new Map<string, RadarModule<any>>()
  private readonly groups = new Map<string, RadarGroupInfo>()

  register(module: RadarModule<any>): this {
    if (!ID_RE.test(module.id)) throw new Error(`Invalid radar module id "${module.id}"`)
    if (this.modules.has(module.id)) throw new Error(`Radar module "${module.id}" is already registered`)
    if (module.allowedHosts.length === 0 && module.kind === 'collector') {
      throw new Error(`Radar module "${module.id}" must declare allowedHosts`)
    }
    this.modules.set(module.id, module)
    return this
  }

  defineGroup(group: RadarGroupInfo): this {
    if (!GROUP_ID_RE.test(group.id)) throw new Error(`Invalid radar group id "${group.id}"`)
    if (this.groups.has(group.id)) throw new Error(`Radar group "${group.id}" is already defined`)
    for (const id of group.moduleIds) {
      if (!this.modules.has(id)) throw new Error(`Radar group "${group.id}" references unknown module "${id}"`)
    }
    this.groups.set(group.id, { ...group, moduleIds: [...group.moduleIds] })
    return this
  }

  /** Startup check of composite dependencies: all must exist and must not form a cycle. */
  validate(): this {
    const visiting = new Set<string>()
    const done = new Set<string>()
    const visit = (id: string, path: string[]) => {
      if (done.has(id)) return
      if (visiting.has(id)) throw new Error(`Radar composite cycle: ${[...path, id].join(' → ')}`)
      visiting.add(id)
      for (const dep of this.modules.get(id)?.dependsOn ?? []) {
        if (!this.modules.has(dep)) throw new Error(`Radar module "${id}" depends on unknown module "${dep}"`)
        visit(dep, [...path, id])
      }
      visiting.delete(id)
      done.add(id)
    }
    for (const id of this.modules.keys()) visit(id, [])
    return this
  }

  has(id: string): boolean {
    return this.modules.has(id)
  }

  hasGroup(id: string): boolean {
    return this.groups.has(id)
  }

  get(id: string): RadarModule<unknown> {
    const module = this.modules.get(id)
    if (!module) throw new UnknownTargetError(`Unknown radar module "${id}"`)
    return module
  }

  getGroup(id: string): RadarGroupInfo {
    const group = this.groups.get(id)
    if (!group) throw new UnknownTargetError(`Unknown radar group "${id}"`)
    return group
  }

  /** Module ids a target expands to (deduplicated, in declaration order). */
  resolve(target: RunTarget): string[] {
    const ids =
      target.kind === 'module' ? [target.id] : target.kind === 'group' ? this.getGroup(target.id).moduleIds : target.ids
    for (const id of ids) this.get(id)
    return [...new Set(ids)]
  }

  listModules(): RadarModuleInfo[] {
    return [...this.modules.values()].map(toInfo)
  }

  listGroups(): RadarGroupInfo[] {
    return [...this.groups.values()].map((group) => ({ ...group, moduleIds: [...group.moduleIds] }))
  }
}

export function toInfo(module: RadarModule<unknown>): RadarModuleInfo {
  return {
    id: module.id,
    name: module.name,
    group: module.group,
    category: module.category ?? null,
    description: module.description,
    source: module.source,
    itemKind: module.itemKind,
    kind: module.kind,
  }
}
