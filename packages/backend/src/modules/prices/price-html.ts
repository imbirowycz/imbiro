import { parseHtml, readJsonLdBlocks } from './price-extract'

// Przygotowanie HTML dla AI (krótszy, bez szumu) i rozpoznawanie stron blokujących.

const DEFAULT_LIMIT = 150_000
const REMOVE = 'script, style, noscript, svg, iframe, link, template, canvas, video, audio, picture source, object, embed'
const KEEP_ATTRS = new Set([
  'id', 'class', 'itemprop', 'itemtype', 'itemscope', 'href', 'content', 'property', 'name', 'datetime',
  'aria-label', 'title', 'alt', 'value', 'type', 'role', 'rel',
])

export interface CleanedHtml {
  html: string
  jsonLd: string[]
  truncated: boolean
}

export function cleanHtmlForPrompt(rawHtml: string, url?: string, limit = DEFAULT_LIMIT): CleanedHtml {
  const doc = parseHtml(rawHtml, url)
  const jsonLd = readJsonLdBlocks(doc).map((block) => (block.length > 20_000 ? `${block.slice(0, 20_000)}…` : block))

  doc.querySelectorAll(REMOVE).forEach((node) => node.remove())
  // Meta zostawiamy tylko te, które mogą nieść cenę/tytuł.
  doc.querySelectorAll('meta').forEach((node) => {
    const key = node.getAttribute('property') ?? node.getAttribute('name') ?? ''
    if (!/^(og:|product:|twitter:title|description)/i.test(key)) node.remove()
  })
  const walker = doc.createTreeWalker(doc, 128 /* NodeFilter.SHOW_COMMENT */)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((node) => node.parentNode?.removeChild(node))

  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const keep = KEEP_ATTRS.has(attr.name) || (attr.name.startsWith('data-') && attr.value.length <= 200)
      if (!keep) el.removeAttribute(attr.name)
      else if (attr.value.length > 300) el.setAttribute(attr.name, `${attr.value.slice(0, 300)}…`)
    }
  })

  const head = [...doc.head.querySelectorAll('title, meta')].map((n) => n.outerHTML).join('\n')
  let body = doc.body?.innerHTML ?? ''
  body = body.replace(/\n\s*\n+/g, '\n').replace(/[ \t]{2,}/g, ' ')

  let truncated = false
  if (head.length + body.length > limit) {
    // Za długo: główna treść strony jest zwykle w <main>.
    const main = doc.querySelector('main, [role="main"], #content, #main')
    if (main) body = main.outerHTML.replace(/\n\s*\n+/g, '\n').replace(/[ \t]{2,}/g, ' ')
    if (head.length + body.length > limit) {
      body = body.slice(0, Math.max(0, limit - head.length))
      truncated = true
    }
  }
  return { html: `${head}\n${body}`.trim(), jsonLd, truncated }
}

const BLOCK_MARKERS: RegExp[] = [
  /cf-browser-verification|challenge-platform|cf_chl_|Just a moment\.\.\.|Attention Required! \| Cloudflare/i,
  /_Incapsula_Resource|Incapsula incident/i,
  /Access Denied[\s\S]{0,200}Reference #/i,
  /perimeterx|px-captcha|_pxCaptcha/i,
  /datadome|geo\.captcha-delivery\.com/i,
  /g-recaptcha|hcaptcha\.com|captcha-container/i,
  /Pardon Our Interruption/i,
]

/** True, gdy odpowiedź wygląda na blokadę antybotową (a nie stronę produktu). */
export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true
  // Amazon i podobne: 202 z krótką stroną weryfikacji zamiast treści.
  if (status === 202 && html.length < 20_000) return true
  // Prawdziwa strona produktu jest zwykle duża; blokady są krótkie i mają charakterystyczne znaczniki.
  const sample = html.length > 400_000 ? html.slice(0, 400_000) : html
  return BLOCK_MARKERS.some((re) => re.test(sample)) && html.length < 200_000
}
