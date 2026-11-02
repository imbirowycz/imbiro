import type { CurrencyRate, GoldPrice, ModuleResult, RadarItemKind, RunResult } from '@myorg/shared'
import type { ModuleRegistry } from '../core/module.registry'

// Turns a RunResult into a channel-neutral digest, then renders it for Telegram (HTML) or e-mail.
// All upstream text is untrusted: it is always escaped, never inserted as markup.

export interface DigestLine {
  text: string
  url?: string
}

export interface DigestSection {
  title: string
  sourceName: string
  attribution: string | null
  dataAsOf: string | null
  /** Set when the module failed — the section then says so instead of silently disappearing. */
  unavailable: string | null
  lines: DigestLine[]
  /** Items left out because of maxItemsPerModule. */
  omitted: number
}

export interface Digest {
  title: string
  sections: DigestSection[]
}

const locale = 'pl-PL'
const pln = (value: number, digits: number) =>
  value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

function signed(change: number | null, digits: number): string {
  if (change === null) return ''
  if (change === 0) return ' (bez zmian)'
  return ` ${change > 0 ? '▲ +' : '▼ −'}${pln(Math.abs(change), digits)}`
}

/** One text line per item, by item kind. Unknown kinds fall back to a count only. */
const lineRenderers: Partial<Record<RadarItemKind, (item: unknown) => DigestLine>> = {
  'currency-rate': (item) => {
    const rate = item as CurrencyRate
    return { text: `${rate.code} ${pln(rate.mid, 4)} zł${signed(rate.change, 4)}` }
  },
  'gold-price': (item) => {
    const gold = item as GoldPrice
    return { text: `Złoto ${pln(gold.pricePerGram, 2)} zł/g${signed(gold.change, 2)}` }
  },
}

export function buildDigest(title: string, run: RunResult, registry: ModuleRegistry, maxItemsPerModule: number): Digest {
  return { title, sections: run.results.map((result) => toSection(result, registry, maxItemsPerModule)) }
}

function toSection(result: ModuleResult, registry: ModuleRegistry, maxItems: number): DigestSection {
  const module = registry.get(result.moduleId)
  const render = result.itemKind ? lineRenderers[result.itemKind] : undefined
  const shown = result.data.slice(0, maxItems)
  return {
    title: module.name,
    sourceName: result.source.name,
    attribution: result.source.attribution ?? null,
    dataAsOf: result.dataAsOf,
    unavailable: result.status === 'error' ? (result.error?.message ?? 'Źródło niedostępne') : null,
    lines: render ? shown.map(render) : shown.length ? [{ text: `${result.data.length} elementów` }] : [],
    omitted: render ? Math.max(0, result.data.length - shown.length) : 0,
  }
}

// ---- Telegram (HTML parse mode) ----

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Only http(s) links are rendered; anything else becomes plain text. */
function safeHref(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function sectionMeta(section: DigestSection): string {
  const parts = [section.sourceName]
  if (section.dataAsOf) parts.push(`stan na ${section.dataAsOf}`)
  return parts.join(', ')
}

/**
 * Renders HTML that fits Telegram's limit. Whole lines are dropped from the end instead of
 * cutting text in the middle of a tag; the reader is told that the message was shortened.
 */
export function renderTelegram(digest: Digest, maxLength: number): string {
  const TRUNCATED = '\n\n… (skrócono)'
  const blocks: string[][] = [[`<b>${escapeHtml(digest.title)}</b>`]]
  for (const section of digest.sections) {
    const block = [`\n<b>${escapeHtml(section.title)}</b> <i>(${escapeHtml(sectionMeta(section))})</i>`]
    if (section.unavailable) block.push(`⚠️ ${escapeHtml(section.unavailable)}`)
    else if (section.lines.length === 0) block.push('brak danych')
    for (const line of section.lines) {
      const href = safeHref(line.url)
      block.push(href ? `• <a href="${escapeHtml(href)}">${escapeHtml(line.text)}</a>` : `• ${escapeHtml(line.text)}`)
    }
    if (section.omitted > 0) block.push(`… i ${section.omitted} więcej`)
    if (section.attribution) block.push(`<i>${escapeHtml(section.attribution)}</i>`)
    blocks.push(block)
  }

  let output = ''
  for (const line of blocks.flat()) {
    const next = output ? `${output}\n${line}` : line
    if (next.length > maxLength - TRUNCATED.length) return output + TRUNCATED
    output = next
  }
  return output
}

// ---- E-mail ----

export function renderEmail(digest: Digest): { text: string; html: string } {
  const text: string[] = [digest.title, '']
  const html: string[] = [`<h2>${escapeHtml(digest.title)}</h2>`]

  for (const section of digest.sections) {
    text.push(`${section.title} (${sectionMeta(section)})`)
    html.push(`<h3>${escapeHtml(section.title)} <small>(${escapeHtml(sectionMeta(section))})</small></h3>`)
    if (section.unavailable) {
      text.push(`  ! ${section.unavailable}`)
      html.push(`<p>⚠️ ${escapeHtml(section.unavailable)}</p>`)
    } else if (section.lines.length === 0) {
      text.push('  brak danych')
      html.push('<p>brak danych</p>')
    } else {
      html.push('<ul>')
      for (const line of section.lines) {
        const href = safeHref(line.url)
        text.push(`  • ${line.text}${href ? ` — ${href}` : ''}`)
        html.push(href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(line.text)}</a></li>` : `<li>${escapeHtml(line.text)}</li>`)
      }
      html.push('</ul>')
    }
    if (section.omitted > 0) {
      text.push(`  … i ${section.omitted} więcej`)
      html.push(`<p>… i ${section.omitted} więcej</p>`)
    }
    if (section.attribution) {
      text.push(`  ${section.attribution}`)
      html.push(`<p><small>${escapeHtml(section.attribution)}</small></p>`)
    }
    text.push('')
  }
  return { text: text.join('\n'), html: html.join('\n') }
}
