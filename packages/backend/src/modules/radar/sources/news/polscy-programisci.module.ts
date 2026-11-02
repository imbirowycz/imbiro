import type { NewsItem } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { localToIso } from '../../core/time'
import { dedupeNews } from '../../parsing/dedupe'
import { byDateDesc, canonicalUrl, isRecent, shortHash, type UnscoredNewsItem } from '../../parsing/news.normalize'
import type { NewsScorer } from '../../parsing/relevance'
import { htmlToText, truncate } from '../../parsing/text'
import { newsItemSchema } from './news.schema'

// polscyprogramisci.pl aggregates Polish IT blogs, news sites and YouTube channels, but has no RSS
// and no API — we read the article cards from its home page (checked 2026-11-02):
//
//   <article class="article-card …">
//     <span class="article-source">sekurak.pl · w biegu</span>
//     <a href="https://original/article" class="article-primary-link">
//       <h2 class="article-title">…</h2> <p class="article-excerpt">…</p>
//     </a>
//     <div class="article-meta"> … 02.11.2026 … </div>
//   </article>
//
// Links point to the original articles. Cards from sites we already read directly (e.g. Sekurak)
// are skipped. When the layout changes and no card is found, the module fails loudly instead of
// silently showing nothing.

const PAGE_URL = 'https://polscyprogramisci.pl/'
const SOURCE = { name: 'Polscy Programiści', homepage: 'https://polscyprogramisci.pl' }

export interface PolscyProgramisciOptions {
  /** Hosts already covered by other modules; cards linking there (or to subdomains) are skipped. */
  excludedHosts: readonly string[]
  timeZone: string
  maxItems: number
  maxAgeDays: number
}

const CARD_START = /<article\b[^>]*class="[^"]*\barticle-card\b[^"]*"[^>]*>/gi

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null
}

/** Inner HTML of the first element with the given class (non-nested elements only). */
function byClass(html: string, tagName: string, className: string): string | null {
  const re = new RegExp(`<${tagName}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tagName}>`, 'i')
  return re.exec(html)?.[1] ?? null
}

/** Home page HTML → news items (unscored, page order). */
export function parsePolscyProgramisci(html: string, timeZone: string): UnscoredNewsItem[] {
  const starts = [...html.matchAll(CARD_START)].map((m) => m.index)
  const items: UnscoredNewsItem[] = []

  starts.forEach((start, i) => {
    const card = html.slice(start, starts[i + 1] ?? html.length)
    const linkTag = /<a\b[^>]*class="[^"]*\barticle-primary-link\b[^"]*"[^>]*>/i.exec(card)?.[0]
    const href = linkTag ? attr(linkTag, 'href') : null
    const url = href ? canonicalUrl(htmlToText(href)) : null
    const title = htmlToText(byClass(card, 'h2', 'article-title') ?? '')
    if (!url || !title) return

    const excerpt = htmlToText(byClass(card, 'p', 'article-excerpt') ?? '')
    // "sekurak.pl · w biegu" → "sekurak.pl"
    const site = htmlToText(byClass(card, 'span', 'article-source') ?? '').split(' · ')[0].trim()
    const date = /\b(\d{2})\.(\d{2})\.(\d{4})\b/.exec(htmlToText(byClass(card, 'div', 'article-meta') ?? ''))

    items.push({
      id: `url:${shortHash(url)}`,
      title: truncate(title, 300),
      summary: excerpt && excerpt !== title ? truncate(excerpt, 280) : null,
      url,
      // The original site is more useful than the aggregator's name.
      source: site ? truncate(site, 80) : SOURCE.name,
      category: 'it',
      // The page gives only the day; midnight local time keeps the day correct when sorting.
      publishedAt: date ? localToIso(`${date[3]}-${date[2]}-${date[1]} 00:00`, timeZone) : null,
      author: null,
    })
  })
  return items
}

function isExcluded(url: string, hosts: readonly string[]): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return hosts.some((excluded) => host === excluded || host.endsWith(`.${excluded}`))
}

export function createPolscyProgramisciModule(options: PolscyProgramisciOptions, scorer: NewsScorer) {
  const excludedHosts = options.excludedHosts.map((host) => host.toLowerCase().replace(/^www\./, ''))

  return defineModule<NewsItem>({
    id: 'news.polscyprogramisci',
    name: 'Polscy Programiści',
    group: 'news',
    category: 'it',
    description: 'Wpisy z polskich blogów i serwisów IT zebrane przez polscyprogramisci.pl',
    source: SOURCE,
    itemKind: 'news',
    kind: 'collector',
    allowedHosts: [new URL(PAGE_URL).hostname],
    itemSchema: newsItemSchema,
    cacheTtlSeconds: 30 * 60,

    async execute({ http, signal, now }) {
      const response = await http.getText(PAGE_URL, { signal, accept: 'text/html' })
      const parsed = parsePolscyProgramisci(response.text, options.timeZone)
      if (parsed.length === 0) {
        throw new RadarSourceError('PARSE_ERROR', 'Nie znaleziono wpisów na stronie Polskich Programistów (zmienił się jej układ?)')
      }

      const at = now()
      const items = dedupeNews(parsed.filter((item) => !isExcluded(item.url, excludedHosts)))
        .filter((item) => isRecent(item, at, options.maxAgeDays) && !scorer.isExcluded(item))
        .sort(byDateDesc)
        .slice(0, options.maxItems)
        .map((item) => ({ ...item, relevance: scorer.score(item, at) }))

      return { data: items, warnings: [] }
    },
  })
}
