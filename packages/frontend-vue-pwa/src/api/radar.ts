import type { ArticleView, DashboardLayout, ModuleResult, RadarGroupInfo, RadarModuleInfo, RunResult } from '@myorg/shared'
import { request } from './client'

/** POST /api/radar/read-items — the server computes the key (newsReadKey / alertReadKey). */
export type MarkReadBody =
  | { kind: 'news'; url: string; title?: string | null; source?: string | null }
  | {
      kind: 'alert'
      id: string
      issuedAt: string | null
      validFrom: string | null
      expiresAt: string | null
      title?: string | null
      source?: string | null
    }

export const radarApi = {
  dashboard: () => request<DashboardLayout>('GET', '/radar/dashboard'),
  listModules: () => request<RadarModuleInfo[]>('GET', '/radar/modules'),
  listGroups: () => request<RadarGroupInfo[]>('GET', '/radar/groups'),
  runModule: (id: string, force = false) =>
    request<ModuleResult>('POST', `/radar/modules/${encodeURIComponent(id)}/run`, { force }),
  runGroup: (id: string, force = false) => request<RunResult>('POST', `/radar/groups/${encodeURIComponent(id)}/run`, { force }),
  runModules: (moduleIds: string[], force = false) => request<RunResult>('POST', '/radar/run', { moduleIds, force }),
  markRead: (body: MarkReadBody) => request<void>('POST', '/radar/read-items', body),
  unmarkRead: (key: string) => request<void>('DELETE', `/radar/read-items?key=${encodeURIComponent(key)}`),
  readArticle: (url: string) => request<ArticleView>('GET', `/radar/articles/read?url=${encodeURIComponent(url)}`),
}
