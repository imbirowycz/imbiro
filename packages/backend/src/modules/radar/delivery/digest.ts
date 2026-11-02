import type {
  AirQualityStation,
  AlertItem,
  AlertSeverity,
  CurrencyRate,
  GoldPrice,
  ModuleResult,
  NewsItem,
  OverviewBlock,
  RadarItemKind,
  RunResult,
  WeatherDay,
  WeatherNow,
} from '@myorg/shared'
import type { ModuleRegistry } from '../core/module.registry'
import { radarConfig } from '../radar.config'

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
  /** Shown above the lines, e.g. "source down, showing data from 12:00" (stale-if-error). */
  note: string | null
  lines: DigestLine[]
  /** Items left out because of maxItemsPerModule. */
  omitted: number
}

export interface Digest {
  title: string
  sections: DigestSection[]
}

const locale = 'pl-PL'
const timeZone = radarConfig.location.timeZone
const pln = (value: number, digits: number) =>
  value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const deg = (value: number) => `${pln(value, Number.isInteger(value) ? 0 : 1)}°C`

function signed(change: number | null, digits: number): string {
  if (change === null) return ''
  if (change === 0) return ' (bez zmian)'
  return ` ${change > 0 ? '▲ +' : '▼ −'}${pln(Math.abs(change), digits)}`
}

/** "2026-11-02" → "2.11.2026"; ISO date-time → "2.11, 12:45" in the configured time zone. */
export function formatWhen(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return `${d}.${m}.${y}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale, { timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const SEVERITY_ICON: Record<AlertSeverity, string> = { high: '🔴', medium: '🟠', low: '🟡', info: 'ℹ️' }

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
  news: (item) => {
    const news = item as NewsItem
    return { text: news.title, url: news.url }
  },
  'weather-now': (item) => {
    const w = item as WeatherNow
    const rainChance = Math.max(0, ...w.hours.map((h) => h.precipitationProbability ?? 0))
    const temps = w.hours.map((h) => h.temperature)
    const range = temps.length ? `, w ciągu ${w.hours.length} h: ${deg(Math.min(...temps))}…${deg(Math.max(...temps))}` : ''
    return {
      text:
        `${deg(w.temperature)} (odczuwalna ${deg(w.apparentTemperature)}), ${w.description}, ` +
        `wiatr ${pln(w.windSpeed, 0)} km/h${w.windGusts !== null ? ` (porywy ${pln(w.windGusts, 0)})` : ''}${range}` +
        (w.hours.some((h) => h.precipitationProbability !== null) ? `, szansa opadów do ${rainChance}%` : ''),
    }
  },
  'weather-day': (item) => {
    const d = item as WeatherDay
    const weekday = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone })
    // Probability when the source gives it (Open-Meteo), otherwise the amount if any (MET Norway).
    const rain =
      d.precipitationProbabilityMax !== null
        ? `, opady ${d.precipitationProbabilityMax}%`
        : d.precipitationSum > 0
          ? `, opady ${pln(d.precipitationSum, 1)} mm`
          : ''
    const [, month, day] = d.date.split('-').map(Number)
    return { text: `${weekday} ${day}.${month}: ${deg(d.temperatureMin)}…${deg(d.temperatureMax)}, ${d.description}${rain}` }
  },
  alert: (item) => {
    const a = item as AlertItem
    const until = a.expiresAt ? ` (do ${formatWhen(a.expiresAt)})` : ''
    return { text: `${SEVERITY_ICON[a.severity]} ${a.title}${until}`, url: a.url ?? undefined }
  },
  'air-quality': (item) => {
    const s = item as AirQualityStation
    const values = s.pollutants
      .filter((p) => p.value !== null)
      .map((p) => `${p.code} ${pln(p.value!, 0)}`)
      .join(', ')
    return { text: `${SEVERITY_ICON[s.severity]} ${s.name}: ${s.indexCategory?.toLowerCase() ?? 'brak indeksu'}${values ? ` (${values} µg/m³)` : ''}` }
  },
}

/** Key identifying the same item across modules (e.g. one RMF article in the Poland and Warsaw feeds). */
function crossModuleKey(kind: RadarItemKind | null, item: unknown): string | null {
  return kind === 'news' ? `news:${(item as NewsItem).url}` : null
}

export function buildDigest(title: string, run: RunResult, registry: ModuleRegistry, maxItemsPerModule: number): Digest {
  const seen = new Set<string>()
  return {
    title,
    sections: run.results.flatMap((result) =>
      result.itemKind === 'overview-block' && result.status !== 'error'
        ? (result.data as OverviewBlock[]).map((block) => blockSection(block, maxItemsPerModule, seen))
        : [toSection(result, registry, maxItemsPerModule, seen)]
    ),
  }
}

function renderLines(kind: RadarItemKind | null, items: unknown[], maxItems: number, seen: Set<string>) {
  const render = kind ? lineRenderers[kind] : undefined
  // Items already shown in an earlier section are skipped, not counted as omitted.
  const fresh = items.filter((item) => {
    const key = crossModuleKey(kind, item)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const shown = fresh.slice(0, maxItems)
  return {
    lines: render ? shown.map(render) : shown.length ? [{ text: `${fresh.length} elementów` }] : [],
    omitted: render ? Math.max(0, fresh.length - shown.length) : 0,
  }
}

function toSection(result: ModuleResult, registry: ModuleRegistry, maxItems: number, seen: Set<string>): DigestSection {
  const module = registry.get(result.moduleId)
  return {
    title: module.name,
    sourceName: result.source.name,
    attribution: result.source.attribution ?? null,
    dataAsOf: result.dataAsOf,
    unavailable: result.status === 'error' ? (result.error?.message ?? 'Źródło niedostępne') : null,
    note: result.stale ? (result.warnings[0] ?? null) : null,
    ...renderLines(result.itemKind, result.data, maxItems, seen),
  }
}

/** A composite's block becomes a regular section, rendered with the block's item kind. */
function blockSection(block: OverviewBlock, maxItems: number, seen: Set<string>): DigestSection {
  return {
    title: block.title,
    sourceName: block.sources.join(', '),
    attribution: block.attributions.length ? block.attributions.join('; ') : null,
    dataAsOf: block.dataAsOf,
    unavailable: block.error,
    note: null,
    ...renderLines(block.itemKind, block.items, maxItems, seen),
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
  if (section.dataAsOf) parts.push(`stan na ${formatWhen(section.dataAsOf)}`)
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
    if (section.note) block.push(`<i>⚠️ ${escapeHtml(section.note)}</i>`)
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
    if (section.note) {
      text.push(`  ! ${section.note}`)
      html.push(`<p><em>⚠️ ${escapeHtml(section.note)}</em></p>`)
    }
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
