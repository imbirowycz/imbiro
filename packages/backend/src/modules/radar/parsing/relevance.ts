import type { NewsItem } from '@myorg/shared'
import type { UnscoredNewsItem } from './news.normalize'

// Rule-based relevance — no AI, fully predictable: the same input always gives the same score.
//
// Keywords:  "vue"      → whole word (case-insensitive), so "ai" does not match "mail"
//            "warszaw*" → word prefix, handles Polish inflection: Warszawa, Warszawie, warszawskich
//
// Score = Σ over matched interests (weight × 2 if in title, × 1 if only in summary) + freshness bonus.
// Items older than `staleAfterHours` score 0 (matches are still listed): the radar is about what is new.

export interface Interest {
  label: string
  keywords: readonly string[]
  weight: number
}

export interface RelevanceRules {
  interests: readonly Interest[]
  /** Items whose title matches any of these are dropped. */
  excludeKeywords: readonly string[]
  /** [maxAgeHours, bonus] — first matching bracket wins. */
  freshnessBonus: readonly (readonly [number, number])[]
  staleAfterHours: number
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Compiles a keyword into a Unicode-aware, case-insensitive matcher. */
export function keywordMatcher(keyword: string): RegExp {
  const normalized = keyword.trim().toLowerCase()
  // "*" = any letters/digits (also inside phrases: "sztuczn* inteligencj*"); spaces = any whitespace.
  const body = normalized
    .split(/\s+/)
    .map((word) => word.split('*').map(escapeRegExp).join('[\\p{L}\\p{N}]*'))
    .join('\\s+')
  const openEnd = normalized.endsWith('*')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${openEnd ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu')
}

export function createScorer(rules: RelevanceRules) {
  const interests = rules.interests.map((interest) => ({ ...interest, matchers: interest.keywords.map(keywordMatcher) }))
  const excluded = rules.excludeKeywords.map(keywordMatcher)

  return {
    isExcluded(item: UnscoredNewsItem): boolean {
      return excluded.some((matcher) => matcher.test(item.title))
    },

    score(item: UnscoredNewsItem, now: Date): NewsItem['relevance'] {
      let score = 0
      const matches: string[] = []
      for (const interest of interests) {
        const inTitle = interest.matchers.some((m) => m.test(item.title))
        const inSummary = !inTitle && !!item.summary && interest.matchers.some((m) => m.test(item.summary!))
        if (inTitle || inSummary) {
          score += interest.weight * (inTitle ? 2 : 1)
          matches.push(interest.label)
        }
      }
      if (item.publishedAt) {
        const ageHours = (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000
        if (ageHours > rules.staleAfterHours) return { score: 0, matches }
        const bracket = rules.freshnessBonus.find(([maxAge]) => ageHours <= maxAge)
        if (bracket) score += bracket[1]
      }
      return { score, matches }
    },
  }
}

export type NewsScorer = ReturnType<typeof createScorer>

/** Highest score first, then newest. */
export function byRelevance(a: NewsItem, b: NewsItem): number {
  if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score
  return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
}
