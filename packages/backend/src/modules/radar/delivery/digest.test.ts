import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ModuleResult, NewsItem, RunResult } from '@myorg/shared'
import { radarRegistry } from '../radar.catalog'
import { buildDigest } from './digest'

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
      skipNewsUrls: ['https://sekurak.pl/artykul-1/'],
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
})
