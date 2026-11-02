import type { ModuleResult, RadarGroupInfo, RadarModuleInfo, RunResult } from '@myorg/shared'
import { request } from './client'

export const radarApi = {
  listModules: () => request<RadarModuleInfo[]>('GET', '/radar/modules'),
  listGroups: () => request<RadarGroupInfo[]>('GET', '/radar/groups'),
  runModule: (id: string, force = false) =>
    request<ModuleResult>('POST', `/radar/modules/${encodeURIComponent(id)}/run`, { force }),
  runGroup: (id: string, force = false) => request<RunResult>('POST', `/radar/groups/${encodeURIComponent(id)}/run`, { force }),
  runModules: (moduleIds: string[], force = false) => request<RunResult>('POST', '/radar/run', { moduleIds, force }),
}
