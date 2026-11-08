import type { PriceDiscoveryCandidate, PriceDiscoveryResult, PriceSourceDefinition } from '@myorg/shared'
import { checkSource, fetchPage, type Fetchers, getFetchers, toTestResult } from './price-check'
import { extractStructured, parseHtml } from './price-extract'
import { type FetchedPage, toFetchError } from './price-fetch'
import { normalizeText, parsePlPrice } from './price-parse'

// „Znajdź źródła”: tak jak porównywarka. 1) Ceneo: strona produktu (najniższa cena ze sklepów)
// i lista sklepów z ofertą. 2) Dla każdego sklepu (z Ceneo + popularne) wyszukiwarka sklepu →
// link do strony produktu. 3) Szybkie sprawdzenie strony w trybie auto.
// Nie przechodzimy przez linki przekierowujące Ceneo (są chronione captchą).

const AUTO: PriceSourceDefinition = { version: 1, strategy: 'auto' }
const TOTAL_BUDGET_MS = 150_000
const MAX_SHOPS = 20
const CONCURRENCY = 3

/** Sklepy sprawdzane zawsze (nawet jeśli Ceneo ich nie pokazuje). */
export const DEFAULT_SHOPS = ['mediaexpert.pl', 'euro.com.pl', 'mediamarkt.pl', 'allegro.pl', 'x-kom.pl', 'morele.net', 'komputronik.pl', 'neonet.pl', 'empik.com']

/** Znane adresy wyszukiwarek; pozostałe sklepy — formularz wyszukiwania ze strony głównej. */
const SEARCH_URLS: Record<string, (q: string) => string> = {
  'mediaexpert.pl': (q) => `https://www.mediaexpert.pl/search?query%5Bquerystring%5D=${q}`,
  'avans.pl': (q) => `https://www.avans.pl/search?query%5Bquerystring%5D=${q}`,
  'electro.pl': (q) => `https://www.electro.pl/search?query%5Bquerystring%5D=${q}`,
  'euro.com.pl': (q) => `https://www.euro.com.pl/search.bhtml?keyword=${q}`,
  'oleole.pl': (q) => `https://www.oleole.pl/search.bhtml?keyword=${q}`,
  'mediamarkt.pl': (q) => `https://mediamarkt.pl/pl/search.html?query=${q}`,
  'allegro.pl': (q) => `https://allegro.pl/listing?string=${q}`,
  'x-kom.pl': (q) => `https://www.x-kom.pl/szukaj?q=${q}`,
  'al.to': (q) => `https://www.al.to/szukaj?q=${q}`,
  'morele.net': (q) => `https://www.morele.net/wyszukiwarka/?q=${q}`,
  'komputronik.pl': (q) => `https://www.komputronik.pl/search/category/1?query=${q}`,
  'neonet.pl': (q) => `https://www.neonet.pl/search.html?query=${q}`,
  'amazon.pl': (q) => `https://www.amazon.pl/s?k=${q}`,
  'empik.com': (q) => `https://www.empik.com/szukaj/produkt?q=${q}`,
}

const STATIC_RE = /\.(jpe?g|png|webp|gif|svg|avif|css|js|ico|woff2?)(\?|$)/i
const SEARCH_RE = /(search|szukaj|wyszuk|listing|query=|keyword=|\/s\?k=|#)/i

// ---------- czyste funkcje ----------

/** Kod modelu z nazwy: najdłuższe „słowo” z literami i cyframi (np. BCC13BLMEU, MZ-V9P1T0BW). */
export function modelToken(text: string): string | null {
  const tokens = text.split(/[\s,;/()]+/).map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ''))
  const candidates = tokens.filter((t) => t.length >= 5 && /\d/.test(t) && /\p{L}/u.test(t))
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => b.length - a.length)[0].toLowerCase()
}

/** Fraza do wyszukiwarek: EAN > kod modelu > nazwa. */
export function searchQuery(name: string, ean?: string | null): string {
  if (ean && /^\d{8,14}$/.test(ean)) return ean
  return modelToken(name) ?? name.trim()
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function shopHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function sameShop(host: string, shop: string): boolean {
  return host === shop || host.endsWith(`.${shop}`)
}

/** Link do strony produktu w wynikach wyszukiwania: ten sam sklep, kod modelu w ścieżce. */
export function pickProductLink(html: string, baseUrl: string, shop: string, token: string): string | null {
  const needle = compact(token)
  // Wyszukiwarka czasem od razu przekierowuje na produkt.
  const base = new URL(baseUrl)
  if (compact(base.pathname).includes(needle) && !SEARCH_RE.test(base.pathname)) return cleanProductUrl(base)

  const seen = new Set<string>()
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let url: URL
    try {
      url = new URL(match[1].replace(/&amp;/g, '&'), baseUrl)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!sameShop(host, shop) || !/^https?:$/.test(url.protocol)) continue
    if (STATIC_RE.test(url.pathname) || SEARCH_RE.test(url.pathname)) continue
    if (!compact(decodeURIComponent(url.pathname)).includes(needle)) continue
    const clean = cleanProductUrl(url)
    if (seen.has(clean)) continue
    seen.add(clean)
    return clean
  }
  return null
}

function cleanProductUrl(url: URL): string {
  const copy = new URL(url.toString())
  copy.hash = ''
  // Parametry śledzące/ofertowe niepotrzebne do strony produktu.
  for (const key of [...copy.searchParams.keys()]) {
    if (/^(utm_|query_id|offerId|bi_|ref|gclid|fbclid)/i.test(key)) copy.searchParams.delete(key)
  }
  return copy.toString()
}

export interface CeneoOffer {
  shop: string
  price: number | null
}

/** Ceneo: produkty z wyników wyszukiwania (id) i oferty sklepów ze strony produktu. */
export function ceneoProductIds(html: string): string[] {
  return [...new Set([...html.matchAll(/href="\/(\d{6,})(?:[#?"][^"]*)?"/g)].map((m) => m[1]))]
}

export function ceneoOffers(doc: Document, productId?: string): CeneoOffer[] {
  const out = new Map<string, CeneoOffer>()
  for (const row of doc.querySelectorAll('[data-shopurl]')) {
    // Tylko oferty tego produktu (strona pokazuje też polecane inne produkty).
    const rowProduct = row.getAttribute('data-productid')
    if (productId && rowProduct && rowProduct !== productId) continue
    const shop = (row.getAttribute('data-shopurl') ?? '').toLowerCase().replace(/^www\./, '')
    if (!shop || shop.includes('ceneo')) continue
    const price = parsePlPrice(row.getAttribute('data-price')) ?? parsePlPrice(row.querySelector('.price')?.textContent)
    const prev = out.get(shop)
    if (!prev || (price !== null && (prev.price === null || price < prev.price))) out.set(shop, { shop, price })
  }
  return [...out.values()]
}

/** Czy tytuł strony pasuje do szukanego artykułu (kod modelu albo większość słów nazwy). */
export function titleMatches(title: string | null, name: string, token: string | null): boolean {
  if (!title) return false
  const t = compact(title)
  if (token) return t.includes(compact(token))
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  if (words.length === 0) return false
  return words.filter((w) => t.includes(compact(w))).length / words.length >= 0.6
}

// ---------- wyszukiwanie ----------

export interface DiscoverParams {
  name: string
  ean?: string | null
  existingUrls?: string[]
  signal?: AbortSignal
  fetchers?: Fetchers
}

export async function discoverSources(params: DiscoverParams): Promise<PriceDiscoveryResult> {
  const started = Date.now()
  const fetchers = params.fetchers ?? getFetchers()
  const deadline = AbortSignal.timeout(TOTAL_BUDGET_MS)
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline
  const query = searchQuery(params.name, params.ean)
  // Linki w sklepach dopasowujemy po kodzie modelu (EAN zwykle nie występuje w adresie).
  const token = modelToken(params.name)
  const existing = new Set((params.existingUrls ?? []).map(shopHost).filter((h): h is string => !!h))
  const candidates: PriceDiscoveryCandidate[] = []

  // 1) Ceneo
  let ceneoUrl: string | null = null
  let offers: CeneoOffer[] = []
  const ceneoSearch = `https://www.ceneo.pl/;szukaj-${encodeURIComponent(query).replace(/%20/g, '+')}`
  try {
    let search = await fetchPage(ceneoSearch, 'auto', signal, fetchers)
    const idsOf = (page: FetchedPage) =>
      /ceneo\.pl\/(\d{6,})/.test(page.finalUrl) ? [/ceneo\.pl\/(\d{6,})/.exec(page.finalUrl)![1]] : ceneoProductIds(page.html)
    let ids = idsOf(search)
    // Ceneo podaje automatom ogólną stronę bez wyników — sprawdź przeglądarką (blokada wyjdzie jako BLOCKED).
    if (ids.length === 0 && search.fetcher === 'http') {
      search = await fetchers.browser.fetch(ceneoSearch, { signal })
      ids = idsOf(search)
    }
    for (const id of ids.slice(0, 4)) {
      const page = id && search.finalUrl.includes(`/${id}`) ? search : await fetchPage(`https://www.ceneo.pl/${id}`, 'auto', signal, fetchers)
      const doc = parseHtml(page.html, page.finalUrl)
      const structured = extractStructured(doc)
      if (!titleMatches(structured.title ?? normalizeText(doc.title), params.name, token)) continue
      ceneoUrl = `https://www.ceneo.pl/${id}`
      offers = ceneoOffers(doc, id)
      if (!existing.has('ceneo.pl')) {
        candidates.push({
          shop: 'Ceneo (najniższa z porównywarki)',
          url: ceneoUrl,
          searchUrl: ceneoSearch,
          status: 'found',
          via: 'ceneo',
          ceneoPrice: structured.price,
          check: await quickCheck(ceneoUrl, signal, fetchers, page),
          message: `Ceneo: ${offers.length} sklepów z ofertą`,
        })
      }
      break
    }
    if (!ceneoUrl) {
      candidates.push({ shop: 'Ceneo', url: null, searchUrl: ceneoSearch, status: 'not_found', via: 'ceneo', ceneoPrice: null, check: null, message: 'Ceneo nie ma tego produktu' })
    }
  } catch (err) {
    if (params.signal?.aborted) throw err
    const error = toFetchError(err, signal)
    // BROWSER_UNAVAILABLE po pustej stronie http = Ceneo nie dało wyników automatowi.
    const blocked = error.code === 'BLOCKED'
    candidates.push({
      shop: 'Ceneo',
      url: null,
      searchUrl: ceneoSearch,
      status: blocked ? 'blocked' : 'error',
      via: 'ceneo',
      ceneoPrice: null,
      check: null,
      message: blocked ? 'Ceneo blokuje ten serwer (captcha) — lista sklepów z Ceneo niedostępna' : error.message,
    })
  }

  // 2) Sklepy: najpierw z Ceneo (od najtańszego), potem popularne.
  const shops: CeneoOffer[] = [...offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
  for (const shop of DEFAULT_SHOPS) if (!shops.some((s) => s.shop === shop)) shops.push({ shop, price: null })
  const queue = shops.filter((s) => !existing.has(s.shop)).slice(0, MAX_SHOPS)

  const results: PriceDiscoveryCandidate[] = new Array(queue.length)
  let next = 0
  const worker = async () => {
    while (next < queue.length && !signal.aborted) {
      const index = next++
      results[index] = await findInShop(queue[index], query, token, params.name, signal, fetchers)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  for (const [i, offer] of queue.entries()) {
    candidates.push(results[i] ?? { shop: offer.shop, url: null, searchUrl: knownSearchUrl(offer.shop, query), status: 'error', via: 'search', ceneoPrice: offer.price, check: null, message: 'Przerwano: limit czasu wyszukiwania' })
  }

  return { query, ceneoUrl, candidates, durationMs: Date.now() - started, timedOut: deadline.aborted }
}

async function findInShop(
  offer: CeneoOffer,
  query: string,
  token: string | null,
  name: string,
  signal: AbortSignal,
  fetchers: Fetchers
): Promise<PriceDiscoveryCandidate> {
  const base = { shop: offer.shop, via: 'search' as const, ceneoPrice: offer.price, searchUrl: knownSearchUrl(offer.shop, query) }
  if (!token) return { ...base, url: null, status: 'not_found', check: null, message: 'Brak kodu modelu w nazwie — nie da się wiarygodnie wskazać produktu' }
  try {
    const searchUrl = await resolveSearchUrl(offer.shop, query, signal, fetchers)
    if (!searchUrl) return { ...base, url: null, status: 'not_found', check: null, message: 'Nie znaleziono wyszukiwarki sklepu' }
    base.searchUrl = searchUrl
    const page = await fetchPage(searchUrl, 'auto', signal, fetchers)
    const url = pickProductLink(page.html, page.finalUrl, offer.shop, token)
    if (!url) return { ...base, url: null, status: 'not_found', check: null, message: 'Wyszukiwarka sklepu nie zwróciła tego modelu' }
    const check = await quickCheck(url, signal, fetchers, url === page.finalUrl ? page : undefined)
    if (check.error?.code === 'BLOCKED') return { ...base, url, status: 'blocked', check, message: 'Sklep blokuje automatyczne zapytania' }
    const title = check.extraction?.title ?? null
    if (check.ok && title && !titleMatches(title, name, token)) {
      return { ...base, url, status: 'not_found', check, message: `Strona wygląda na inny produkt: ${title}` }
    }
    return { ...base, url, status: 'found', check, message: check.ok ? null : 'Strona znaleziona, ale bez ceny w danych strukturalnych — potrzebna definicja od AI' }
  } catch (err) {
    const error = toFetchError(err, signal)
    const blocked = error.code === 'BLOCKED'
    return {
      ...base,
      url: null,
      status: blocked ? 'blocked' : 'error',
      check: null,
      message: blocked ? 'Sklep blokuje ten serwer — dodaj źródło i wklej link do produktu ze swojej przeglądarki' : error.message,
    }
  }
}

/** Adres wyszukiwarki bez pobierania czegokolwiek (znane sklepy), inaczej strona główna. */
function knownSearchUrl(shop: string, query: string): string {
  const known = Object.entries(SEARCH_URLS).find(([host]) => sameShop(shop, host))
  return known ? known[1](encodeURIComponent(query)) : `https://${shop}/`
}

async function resolveSearchUrl(shop: string, query: string, signal: AbortSignal, fetchers: Fetchers): Promise<string | null> {
  const q = encodeURIComponent(query)
  const known = Object.entries(SEARCH_URLS).find(([host]) => sameShop(shop, host))
  if (known) return known[1](q)
  // Formularz wyszukiwania ze strony głównej sklepu.
  const home = await fetchPage(`https://${shop}/`, 'auto', signal, fetchers)
  const doc = parseHtml(home.html, home.finalUrl)
  const input = doc.querySelector(
    'form input[type=search], form input[name=q], form input[name=s], form input[name=search], form input[name=query], form input[name=phrase], form input[name=keyword], form input[name=text], form input[name=szukaj]'
  ) as HTMLInputElement | null
  const form = input?.closest('form')
  if (!form || !input?.name) return null
  if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') return null
  const action = new URL(form.getAttribute('action') || home.finalUrl, home.finalUrl)
  for (const hidden of form.querySelectorAll('input[type=hidden][name]')) {
    action.searchParams.set(hidden.getAttribute('name')!, hidden.getAttribute('value') ?? '')
  }
  action.searchParams.set(input.name, query)
  return action.toString()
}

async function quickCheck(url: string, signal: AbortSignal, fetchers: Fetchers, page?: FetchedPage) {
  if (page) {
    // Strona już pobrana — bez drugiego zapytania.
    const reuse: Fetchers = {
      http: { kind: 'http', fetch: async () => (page.fetcher === 'http' ? page : fetchers.http.fetch(url, { signal })) },
      browser: { kind: 'browser', fetch: async () => (page.fetcher === 'browser' ? page : fetchers.browser.fetch(url, { signal })) },
    }
    return toTestResult(await checkSource({ url, mode: 'auto', preferred: page.fetcher, definition: AUTO, signal, fetchers: reuse }))
  }
  return toTestResult(await checkSource({ url, mode: 'auto', definition: AUTO, signal, fetchers }))
}
