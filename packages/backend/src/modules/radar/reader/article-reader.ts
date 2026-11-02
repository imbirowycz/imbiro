import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import sanitizeHtml from 'sanitize-html'
import type { ArticleView } from '@myorg/shared'
import { createHttpClient, toSourceError } from '../http/safe-fetch'
import { canonicalUrl } from '../parsing/news.normalize'
import { createGuardedFetch } from './ssrf-guard'

// Article Reader: fetches ONE article on the user's request, extracts the main text with
// Mozilla Readability (the engine of Firefox Reader View) and returns sanitized HTML.
// Never stored in the database; a short in-memory cache avoids refetching the same page.
// It reads only what the page serves publicly — no paywall or login bypass.

const MAX_HTML_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 15_000
/** Less extracted text than this usually means a teaser, a paywall or a non-article page. */
const MIN_TEXT_LENGTH = 600
const WORDS_PER_MINUTE = 200

export class ReaderBusyError extends Error {
  constructor() {
    super('Article reader is busy')
    this.name = new.target.name
  }
}

/** Structure and links only. Images and embeds are dropped (privacy, CSP — decided in stage 0). */
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 'b', 'i',
    'a', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'abbr', 'q', 'cite', 'small', 'mark',
    'dl', 'dt', 'dd',
  ],
  // target/rel are listed because attribute filtering runs after transformTags (which sets them).
  allowedAttributes: { a: ['href', 'target', 'rel'], abbr: ['title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'] },
  allowedSchemes: ['http', 'https'],
  allowProtocolRelative: false,
  // Content of these is dropped entirely (not just the tag): captions without images, widgets, forms.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'figcaption', 'svg', 'iframe', 'button', 'form', 'nav', 'aside'],
  transformTags: {
    // The page title is shown separately; article headings start at h2.
    h1: 'h2',
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
  },
  exclusiveFilter: (frame) => ['p', 'li', 'blockquote'].includes(frame.tag) && !frame.text.trim(),
}

export interface ArticleReaderOptions {
  /** Article URL must be on one of these domains or their subdomains. */
  allowedDomains: readonly string[]
  fetchImpl?: typeof fetch
  maxConcurrent?: number
  maxQueue?: number
  cacheTtlMs?: number
  now?: () => Date
}

export class ArticleReader {
  readonly domains: string[]
  private readonly http
  private readonly cache = new Map<string, { view: ArticleView; expiresAt: number }>()
  private readonly cacheTtlMs: number
  private readonly maxConcurrent: number
  private readonly maxQueue: number
  private readonly now: () => Date
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(options: ArticleReaderOptions) {
    this.domains = options.allowedDomains.map((d) => d.toLowerCase())
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60_000
    this.maxConcurrent = options.maxConcurrent ?? 2
    this.maxQueue = options.maxQueue ?? 8
    this.now = options.now ?? (() => new Date())
    this.http = createHttpClient({
      allowedHosts: [],
      isAllowedHost: (host) => this.isAllowedHost(host),
      // Connections only to public IP addresses (SSRF guard), checked at connect time.
      fetchImpl: options.fetchImpl ?? createGuardedFetch(),
    })
  }

  isAllowedHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return this.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  }

  async read(rawUrl: string): Promise<ArticleView> {
    // Canonical form (no tracking params, no fragment); plain http is upgraded to https.
    const url = canonicalUrl(rawUrl.replace(/^http:\/\//i, 'https://'))
    // Never echo an invalid URL back (it could be e.g. a javascript: link rendered by a client).
    if (!url) return this.view('', 'unsupported', 'To nie jest poprawny adres artykułu.')
    const host = new URL(url).hostname
    if (!this.isAllowedHost(host)) {
      return this.view(url, 'unsupported', `Tryb czytania nie obsługuje ${host}. Otwórz artykuł na stronie źródła.`)
    }

    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > Date.now()) return cached.view

    const view = await this.withSlot(() => this.fetchAndExtract(url))
    // Failures are cached briefly, so a broken page is not hammered by repeated clicks.
    const ttl = view.status === 'success' ? this.cacheTtlMs : Math.min(this.cacheTtlMs, 5 * 60_000)
    this.cache.set(url, { view, expiresAt: Date.now() + ttl })
    this.pruneCache()
    return view
  }

  private async fetchAndExtract(url: string): Promise<ArticleView> {
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    let html: string
    let finalUrl: string
    try {
      const response = await this.http.getText(url, {
        signal,
        maxBytes: MAX_HTML_BYTES,
        retries: 1,
        accept: 'text/html,application/xhtml+xml;q=0.9',
      })
      if (!/html/i.test(response.contentType)) {
        return this.view(url, 'unavailable', 'Pod tym adresem nie ma strony z artykułem.')
      }
      html = response.text
      finalUrl = response.url
    } catch (err) {
      const error = toSourceError(err, signal)
      console.warn(`[reader] ${new URL(url).hostname}: ${error.code} ${error.message}`)
      return this.view(url, 'unavailable', `Nie udało się pobrać artykułu: ${error.message}.`)
    }

    // jsdom without scripts and without loading any sub-resources (its defaults) — only parses the HTML.
    const dom = new JSDOM(html, { url: finalUrl, virtualConsole: new VirtualConsole() })
    try {
      const document = dom.window.document
      const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null
      const article = new Readability(document, { charThreshold: 500, keepClasses: false }).parse()
      const text = article?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

      if (!article?.content || text.length < MIN_TEXT_LENGTH) {
        return this.view(
          url,
          'unavailable',
          'Nie udało się wyodrębnić treści. Artykuł może być dostępny tylko dla subskrybentów albo strona ma nietypową budowę.',
          { title: article?.title || meta('meta[property="og:title"]'), excerpt: article?.excerpt || meta('meta[name="description"]') }
        )
      }

      const words = text.split(' ').length
      const published = article.publishedTime || meta('meta[property="article:published_time"]')
      const publishedTime = published ? Date.parse(published) : NaN
      return {
        status: 'success',
        url,
        title: article.title?.trim() || null,
        author: article.byline?.trim() || null,
        source: article.siteName?.trim() || new URL(finalUrl).hostname.replace(/^www\./, ''),
        publishedAt: Number.isNaN(publishedTime) ? null : new Date(publishedTime).toISOString(),
        excerpt: article.excerpt?.trim() || null,
        html: sanitizeHtml(article.content, SANITIZE),
        text,
        wordCount: words,
        readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
        fetchedAt: this.now().toISOString(),
        message: null,
      }
    } catch (err) {
      console.error('[reader] extraction failed', err)
      return this.view(url, 'unavailable', 'Nie udało się odczytać strony artykułu.')
    } finally {
      dom.window.close()
    }
  }

  private view(
    url: string,
    status: Exclude<ArticleView['status'], 'success'>,
    message: string,
    extra: { title?: string | null; excerpt?: string | null } = {}
  ): ArticleView {
    let source = url
    try {
      source = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      // keep the raw value
    }
    return {
      status,
      url,
      title: extra.title ?? null,
      author: null,
      source,
      publishedAt: null,
      excerpt: extra.excerpt ?? null,
      html: null,
      text: null,
      wordCount: 0,
      readingMinutes: 0,
      fetchedAt: this.now().toISOString(),
      message,
    }
  }

  /** jsdom is CPU- and memory-hungry: at most `maxConcurrent` extractions, a short queue, then "busy". */
  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxQueue) throw new ReaderBusyError()
      // The finishing request hands its slot over directly (no gap a newcomer could jump into).
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else {
      this.active++
    }
    try {
      return await fn()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }

  private pruneCache(max = 100): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key)
    while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!)
  }
}

