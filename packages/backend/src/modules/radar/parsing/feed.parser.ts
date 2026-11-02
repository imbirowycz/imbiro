import { XMLParser } from 'fast-xml-parser'
import { RadarSourceError } from '../core/radar.errors'

// RSS 2.0, RSS 1.0 (RDF) and Atom → one raw entry shape. No normalization here, only extraction.
// fast-xml-parser does not resolve external entities (XXE) and limits entity expansion.

export interface FeedEntry {
  id: string | null
  title: string | null
  /** Link as found in the feed (may be relative). */
  link: string | null
  /** HTML or text, as in the feed. */
  summary: string | null
  published: string | null
  author: string | null
}

export interface ParsedFeed {
  format: 'rss' | 'rdf' | 'atom'
  /** Channel link — base for relative entry links. */
  link: string | null
  entries: FeedEntry[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // XML entities only; HTML entities inside text are decoded later by htmlToText.
  processEntities: true,
  htmlEntities: false,
  trimValues: true,
  // Keep everything as strings: "2026" must not become a number, "1.10" not 1.1.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
})

type Node = Record<string, unknown>

/** Text content of a node that may be a string, {#text}, an array or missing. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return text(value[0])
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return text((value as Node)['#text'])
  return null
}

/** Atom links: prefer rel="alternate" (or no rel), fall back to the first href. */
function atomLink(value: unknown): string | null {
  const links = (Array.isArray(value) ? value : [value]).filter(Boolean) as Node[]
  const alternate = links.find((link) => typeof link === 'object' && (!link['@_rel'] || link['@_rel'] === 'alternate'))
  const chosen = alternate ?? links[0]
  if (!chosen) return null
  return typeof chosen === 'string' ? chosen : text(chosen['@_href'])
}

function atomAuthor(value: unknown): string | null {
  const author = Array.isArray(value) ? value[0] : value
  return author && typeof author === 'object' ? text((author as Node).name) : text(author)
}

export function parseFeed(xml: string): ParsedFeed {
  let doc: Node
  try {
    doc = parser.parse(xml) as Node
  } catch {
    throw new RadarSourceError('PARSE_ERROR', 'Nie udało się odczytać kanału RSS/Atom')
  }

  const rss = doc.rss as Node | undefined
  if (rss && typeof rss === 'object') {
    const channel = (rss.channel ?? {}) as Node
    return {
      format: 'rss',
      link: text(channel.link),
      entries: ((channel.item ?? []) as Node[]).map((item) => ({
        id: text(item.guid),
        title: text(item.title),
        link: text(item.link),
        summary: text(item.description) ?? text(item['content:encoded']),
        published: text(item.pubDate) ?? text(item['dc:date']),
        author: text(item['dc:creator']) ?? text(item.author),
      })),
    }
  }

  const rdf = doc['rdf:RDF'] as Node | undefined
  if (rdf && typeof rdf === 'object') {
    return {
      format: 'rdf',
      link: text((rdf.channel as Node | undefined)?.link),
      entries: ((rdf.item ?? []) as Node[]).map((item) => ({
        id: text(item['@_rdf:about']),
        title: text(item.title),
        link: text(item.link),
        summary: text(item.description),
        published: text(item['dc:date']),
        author: text(item['dc:creator']),
      })),
    }
  }

  const feed = doc.feed as Node | undefined
  if (feed && typeof feed === 'object') {
    return {
      format: 'atom',
      link: atomLink(feed.link),
      entries: ((feed.entry ?? []) as Node[]).map((entry) => ({
        id: text(entry.id),
        title: text(entry.title),
        link: atomLink(entry.link),
        summary: text(entry.summary) ?? text(entry.content),
        published: text(entry.published) ?? text(entry.updated),
        author: atomAuthor(entry.author),
      })),
    }
  }

  throw new RadarSourceError('PARSE_ERROR', 'Odpowiedź źródła nie jest kanałem RSS ani Atom')
}
