import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { alertReadKey, newsReadKey, type AlertItem, type ModuleResult, type NewsItem, type RunResult } from '@myorg/shared'
import { createRadarRegistry } from '../radar.catalog'
import { buildDigest } from './digest'

const radarRegistry = createRadarRegistry()

const news = (n: number): NewsItem => ({
  id: `id-${n}`,
  title: `Artykuł ${n}`,
  summary: null,
  url: `https://sekurak.pl/artykul-${n}/`,
  source: 'Sekurak',
  category: 'security',
  publishedAt: '2026-11-02T10:00:00.000Z',
  author: null,
  relevance: { score: 0, matches: [] },
})

const run = (items: NewsItem[]): RunResult => {
  const result: ModuleResult = {
    moduleId: 'news.sekurak',
    group: 'news',
    itemKind: 'news',
    source: { name: 'Sekurak', homepage: 'https://sekurak.pl' },
    status: 'success',
    fetchedAt: '2026-11-02T10:00:00.000Z',
    durationMs: 1,
    cached: false,
    stale: false,
    dataAsOf: null,
    data: items,
    warnings: [],
    error: null,
  }
  return { target: { kind: 'module', id: 'news.sekurak' }, status: 'success', startedAt: result.fetchedAt, durationMs: 1, results: [result] }
}

describe('buildDigest', () => {
  it('skips news marked as read without counting them as omitted', () => {
    const digest = buildDigest('Test', run([news(1), news(2), news(3)]), radarRegistry, 1, {
      skipKeys: [newsReadKey('https://sekurak.pl/artykul-1/')],
    })
    const [section] = digest.sections
    assert.equal(section.lines.length, 1)
    assert.match(JSON.stringify(section.lines[0]), /Artykuł 2/)
    // Only article 3 is left out by the limit; the read article 1 is not counted.
    assert.equal(section.omitted, 1)
  })

  it('shows everything when nothing is marked as read', () => {
    const digest = buildDigest('Test', run([news(1), news(2)]), radarRegistry, 5)
    assert.equal(digest.sections[0].lines.length, 2)
  })

  it('skips alerts marked as read, but shows a re-issued version again', () => {
    const alert = (issuedAt: string): AlertItem => ({
      id: 'imgw-meteo-1',
      source: 'IMGW-PIB',
      category: 'weather',
      title: `Silny wiatr (${issuedAt})`,
      description: null,
      severity: 'medium',
      location: 'Warszawa',
      issuedAt,
      validFrom: null,
      expiresAt: null,
      url: null,
    })
    const base = run([])
    const result = { ...base.results[0], moduleId: 'alerts.imgw', group: 'alerts' as const, itemKind: 'alert' as const, data: [alert('2026-11-02T08:00:00Z')] }
    const read = [alertReadKey(alert('2026-11-02T08:00:00Z'))]

    const hidden = buildDigest('Test', { ...base, results: [result] }, radarRegistry, 5, { skipKeys: read })
    assert.equal(hidden.sections[0].lines.length, 0)

    const reissued = { ...result, data: [alert('2026-11-02T14:00:00Z')] }
    const shown = buildDigest('Test', { ...base, results: [reissued] }, radarRegistry, 5, { skipKeys: read })
    assert.equal(shown.sections[0].lines.length, 1)
  })
})
