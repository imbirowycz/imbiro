import { z } from 'zod'
import type { AlertItem, AlertSeverity } from '@myorg/shared'

export const alertItemSchema: z.ZodType<AlertItem> = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  category: z.enum(['weather', 'hydro', 'air', 'transport']),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable(),
  severity: z.enum(['info', 'low', 'medium', 'high']),
  location: z.string().min(1),
  issuedAt: z.iso.datetime().nullable(),
  validFrom: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  url: z.url({ protocol: /^https?$/ }).nullable(),
})

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 }

export function severityRank(severity: AlertSeverity): number {
  return SEVERITY_RANK[severity]
}

/** Most severe first, then the newest. */
export function bySeverity(a: AlertItem, b: AlertItem): number {
  const diff = severityRank(b.severity) - severityRank(a.severity)
  if (diff !== 0) return diff
  return (b.issuedAt ?? '').localeCompare(a.issuedAt ?? '')
}
