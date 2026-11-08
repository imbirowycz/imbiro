import { JSDOM, VirtualConsole } from 'jsdom'
import type {
  PriceAvailabilitySelector,
  PriceExtraction,
  PriceFieldComparison,
  PriceFieldSelector,
  PriceSourceDefinition,
  PriceStrategyUsed,
} from '@myorg/shared'
import { normalizeText, parseNumber, parsePlPrice } from './price-parse'

// Silnik ekstrakcji: czyste funkcje HTML → dane produktu. Bez sieci i bez wykonywania skryptów
// strony (jsdom domyślnie ich nie uruchamia).

export class DefinitionError extends Error {}

interface Structured {
  title: string | null
  price: number | null
  oldPrice: number | null
  currency: string | null
  available: boolean | null
  from: PriceStrategyUsed | null
}

export interface ExtractOutput {
  extraction: PriceExtraction
  selectorMatches: { field: string; selector: string; count: number }[]
}

// Bez logów jsdom (np. „Could not parse CSS stylesheet”) — style stron nas nie interesują.
const silentConsole = new VirtualConsole()

export function parseHtml(html: string, url?: string): Document {
  return new JSDOM(html, { url: safeUrl(url), virtualConsole: silentConsole }).window.document
}

function safeUrl(url?: string): string | undefined {
  try {
    return url ? new URL(url).toString() : undefined
  } catch {
    return undefined
  }
}

export function extractProduct(html: string, definition: PriceSourceDefinition, url?: string): ExtractOutput {
  const doc = parseHtml(html, url)
  const warnings: string[] = []
  const selectorMatches: ExtractOutput['selectorMatches'] = []
  const structured = extractStructured(doc)

  let price = structured.price
  let priceFrom = structured.from
  let oldPrice = structured.oldPrice
  let title = structured.title
  let available = structured.available

  const run = (field: string, spec: PriceFieldSelector | undefined): string | null => {
    if (!spec) return null
    const nodes = queryAll(doc, spec.selector)
    selectorMatches.push({ field, selector: spec.selector, count: nodes.length })
    if (nodes.length === 0) {
      warnings.push(`Selektor ${field} („${spec.selector}”) nie trafia w żaden element`)
      return null
    }
    if (nodes.length > 1) warnings.push(`Selektor ${field} trafia w ${nodes.length} elementy — użyto pierwszego`)
    return readValue(nodes[0], spec.attr)
  }

  if (definition.price) {
    const raw = run('price', definition.price)
    const value = parseValue(raw, definition.price.parse ?? 'pl-price')
    if (typeof value === 'number') {
      price = value
      priceFrom = 'css'
    } else if (definition.strategy === 'css') {
      price = null
      priceFrom = null
    }
  }
  if (definition.oldPrice) {
    const raw = run('oldPrice', definition.oldPrice)
    const value = parseValue(raw, definition.oldPrice.parse ?? 'pl-price')
    oldPrice = typeof value === 'number' ? value : null
  }
  if (definition.title) {
    const raw = run('title', definition.title)
    title = normalizeText(raw) ?? title
  }
  if (definition.availability) {
    available = readAvailability(doc, definition.availability, selectorMatches, warnings) ?? available
  }

  title ??= normalizeText(doc.querySelector('h1')?.textContent) ?? normalizeText(doc.title)
  // Stara cena nie niższa od bieżącej nie jest promocją.
  if (oldPrice !== null && price !== null && oldPrice <= price) oldPrice = null
  if (price === null) warnings.push('Nie znaleziono ceny')

  return {
    extraction: {
      title,
      price,
      oldPrice,
      currency: definition.currency ?? structured.currency ?? 'PLN',
      available,
      strategyUsed: price === null ? null : priceFrom,
      warnings,
    },
    selectorMatches,
  }
}

function queryAll(doc: Document, selector: string): Element[] {
  try {
    return [...doc.querySelectorAll(selector)]
  } catch {
    throw new DefinitionError(`Niepoprawny selektor CSS: ${selector}`)
  }
}

/** Sprawdza składnię wszystkich selektorów definicji (bez pobierania strony). */
export function assertSelectorsValid(definition: PriceSourceDefinition): void {
  const doc = emptyDoc()
  for (const spec of [definition.price, definition.oldPrice, definition.title, definition.availability]) {
    if (spec) queryAll(doc, spec.selector)
  }
  if (definition.fetch?.waitFor) queryAll(doc, definition.fetch.waitFor)
}

let cachedEmpty: Document | null = null
function emptyDoc(): Document {
  cachedEmpty ??= new JSDOM('<!doctype html><html><body></body></html>').window.document
  return cachedEmpty
}

function readValue(node: Element, attr?: string | null): string | null {
  if (attr) return node.getAttribute(attr)
  return node.textContent
}

function parseValue(raw: string | null, kind: string): number | string | null {
  if (raw == null) return null
  if (kind === 'text') return normalizeText(raw)
  if (kind === 'number') return parseNumber(raw)
  return parsePlPrice(raw)
}

function readAvailability(
  doc: Document,
  spec: PriceAvailabilitySelector,
  matches: ExtractOutput['selectorMatches'],
  warnings: string[]
): boolean | null {
  const nodes = queryAll(doc, spec.selector)
  matches.push({ field: 'availability', selector: spec.selector, count: nodes.length })
  if (nodes.length === 0) {
    warnings.push(`Selektor dostępności („${spec.selector}”) nie trafia w żaden element — przyjęto „niedostępny”`)
    return false
  }
  const value = (readValue(nodes[0], spec.attr) ?? '').toLowerCase()
  return spec.inStockIf.some((needle) => value.includes(needle.toLowerCase()))
}

// ---------- dane strukturalne ----------

export function extractStructured(doc: Document): Structured {
  return fromJsonLd(doc) ?? fromOpenGraph(doc) ?? fromMicrodata(doc) ?? emptyStructured(doc)
}

function emptyStructured(doc: Document): Structured {
  return { title: metaContent(doc, 'og:title'), price: null, oldPrice: null, currency: null, available: null, from: null }
}

export function readJsonLdBlocks(doc: Document): string[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => (node.textContent ?? '').trim())
    .filter(Boolean)
}

function fromJsonLd(doc: Document): Structured | null {
  const products: Record<string, unknown>[] = []
  for (const block of readJsonLdBlocks(doc)) {
    let data: unknown
    try {
      data = JSON.parse(block)
    } catch {
      continue
    }
    collectProducts(data, products, 0)
  }
  for (const product of products) {
    const offer = pickOffer(product.offers)
    if (!offer) continue
    return {
      title: normalizeText(asString(product.name)),
      price: offer.price,
      oldPrice: offer.oldPrice,
      currency: offer.currency,
      available: offer.available,
      from: 'jsonld',
    }
  }
  return null
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const value = node['@type']
  const types = Array.isArray(value) ? value : [value]
  return types.some((t) => typeof t === 'string' && (t === type || t.endsWith(`/${type}`)))
}

function collectProducts(data: unknown, out: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || data === null || typeof data !== 'object') return
  if (Array.isArray(data)) {
    for (const entry of data) collectProducts(entry, out, depth + 1)
    return
  }
  const node = data as Record<string, unknown>
  if (hasType(node, 'Product') || hasType(node, 'ProductGroup')) out.push(node)
  if (node['@graph']) collectProducts(node['@graph'], out, depth + 1)
  if (node.mainEntity) collectProducts(node.mainEntity, out, depth + 1)
  if (node.hasVariant) collectProducts(node.hasVariant, out, depth + 1)
}

interface OfferData {
  price: number
  oldPrice: number | null
  currency: string | null
  available: boolean | null
}

function pickOffer(raw: unknown): OfferData | null {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object'
  )
  const offers: OfferData[] = []
  for (const offer of list) {
    if (hasType(offer, 'AggregateOffer') && offer.offers) {
      const inner = pickOffer(offer.offers)
      if (inner) offers.push(inner)
    }
    const specs = toArray(offer.priceSpecification)
    let price = parseNumber(asString(offer.price) ?? asString(offer.lowPrice))
    let oldPrice: number | null = null
    for (const spec of specs) {
      const priceType = asString(spec.priceType) ?? ''
      const value = parseNumber(asString(spec.price))
      if (value === null) continue
      if (/StrikethroughPrice|ListPrice|MSRP/i.test(priceType)) oldPrice = value
      else price ??= value
    }
    if (price === null) continue
    const availability = asString(offer.availability)
    offers.push({
      price,
      oldPrice,
      currency: asString(offer.priceCurrency) ?? asString(specs[0]?.priceCurrency) ?? null,
      available: availability ? /InStock|LimitedAvailability|OnlineOnly|PreSale|InStoreOnly/i.test(availability) : null,
    })
  }
  if (offers.length === 0) return null
  // Najtańsza dostępna oferta, a jeśli żadna nie jest oznaczona jako dostępna — najtańsza.
  const available = offers.filter((o) => o.available !== false)
  return (available.length ? available : offers).reduce((best, o) => (o.price < best.price ? o : best))
}

function toArray(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

function metaContent(doc: Document, property: string): string | null {
  const node = doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)
  return normalizeText(node?.getAttribute('content'))
}

function fromOpenGraph(doc: Document): Structured | null {
  const price = parseNumber(metaContent(doc, 'product:price:amount') ?? metaContent(doc, 'og:price:amount'))
  if (price === null) return null
  const availability = metaContent(doc, 'product:availability') ?? metaContent(doc, 'og:availability')
  return {
    title: metaContent(doc, 'og:title'),
    price,
    oldPrice: parseNumber(metaContent(doc, 'product:original_price:amount')),
    currency: metaContent(doc, 'product:price:currency') ?? metaContent(doc, 'og:price:currency'),
    available: availability ? /in ?stock|instock|available|dostępny/i.test(availability) && !/out|niedost/i.test(availability) : null,
    from: 'opengraph',
  }
}

function fromMicrodata(doc: Document): Structured | null {
  const scope = doc.querySelector('[itemtype*="schema.org/Product"]') ?? doc
  const priceNode = scope.querySelector('[itemprop="price"]')
  if (!priceNode) return null
  const raw = priceNode.getAttribute('content') ?? priceNode.textContent
  const price = priceNode.getAttribute('content') ? parseNumber(raw) : parsePlPrice(raw)
  if (price === null) return null
  const currencyNode = scope.querySelector('[itemprop="priceCurrency"]')
  const availabilityNode = scope.querySelector('[itemprop="availability"]')
  const availability =
    availabilityNode?.getAttribute('href') ?? availabilityNode?.getAttribute('content') ?? availabilityNode?.textContent ?? null
  const nameNode = scope.querySelector('[itemprop="name"]')
  return {
    title: normalizeText(nameNode?.getAttribute('content') ?? nameNode?.textContent),
    price,
    oldPrice: null,
    currency: normalizeText(currencyNode?.getAttribute('content') ?? currencyNode?.textContent),
    available: availability ? /InStock|LimitedAvailability/i.test(availability) : null,
    from: 'microdata',
  }
}

// ---------- porównanie z wartościami oczekiwanymi przez AI ----------

export function compareWithExpected(
  extraction: PriceExtraction,
  expected: PriceSourceDefinition['expected']
): PriceFieldComparison[] {
  if (!expected) return []
  const out: PriceFieldComparison[] = []
  if (expected.price !== undefined) {
    out.push({
      field: 'price',
      expected: expected.price,
      actual: extraction.price,
      ok: extraction.price !== null && Math.abs(extraction.price - expected.price) < 0.011,
    })
  }
  if (expected.oldPrice !== undefined) {
    const exp = expected.oldPrice ?? null
    out.push({
      field: 'oldPrice',
      expected: exp,
      actual: extraction.oldPrice,
      ok: exp === null ? extraction.oldPrice === null : extraction.oldPrice !== null && Math.abs(extraction.oldPrice - exp) < 0.011,
    })
  }
  if (expected.title !== undefined) {
    const a = simplify(extraction.title)
    const e = simplify(expected.title)
    out.push({ field: 'title', expected: expected.title, actual: extraction.title, ok: !!a && !!e && (a.includes(e) || e.includes(a)) })
  }
  if (expected.available !== undefined) {
    out.push({ field: 'available', expected: expected.available, actual: extraction.available, ok: extraction.available === expected.available })
  }
  return out
}

function simplify(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}
