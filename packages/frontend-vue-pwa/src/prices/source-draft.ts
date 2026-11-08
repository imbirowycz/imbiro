import type { PriceFetchMode, PriceSource, PriceSourceDefinition, PriceSourceStatus, PriceSourceTestResult } from '@myorg/shared'

export interface SourceDraft {
  key: string
  id?: string
  label: string
  url: string
  fetchMode: PriceFetchMode
  definitionText: string
  status?: PriceSourceStatus
  lastError?: string | null
  lastPrice?: number | null
  test: PriceSourceTestResult | null
  /** Z „Znajdź źródła”, gdy sklep blokuje serwer: wyszukiwarka sklepu do otwarcia u siebie. */
  searchUrl?: string | null
}

let counter = 0
export function newDraft(): SourceDraft {
  return { key: `new-${++counter}`, label: '', url: '', fetchMode: 'auto', definitionText: '', test: null }
}

export function draftFromSource(source: PriceSource): SourceDraft {
  return {
    key: source.id,
    id: source.id,
    label: source.label,
    url: source.url,
    fetchMode: source.fetchMode,
    definitionText: JSON.stringify(source.definition, null, 2),
    status: source.status,
    lastError: source.lastError,
    lastPrice: source.lastPrice,
    test: null,
  }
}

export type ParsedDefinition =
  | { kind: 'empty' }
  | { kind: 'definition'; value: PriceSourceDefinition }
  | { kind: 'refusal'; code: string; message: string }
  | { kind: 'invalid'; message: string }

/** Odpowiedź AI: czysty JSON, blok ```json``` albo pierwszy obiekt {...} w tekście. */
export function parseDefinition(text: string): ParsedDefinition {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'empty' }
  const candidates = [trimmed]
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fence) candidates.push(fence[1].trim())
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const error = value.error as { code?: string; message?: string } | undefined
      if (error && typeof error === 'object') return { kind: 'refusal', code: String(error.code ?? 'error'), message: String(error.message ?? '') }
      if (value.version !== 1) return { kind: 'invalid', message: 'Brak "version": 1 — to nie wygląda na definicję źródła' }
      if (value.strategy !== 'auto' && value.strategy !== 'css') return { kind: 'invalid', message: '"strategy" musi być "auto" albo "css"' }
      return { kind: 'definition', value: value as unknown as PriceSourceDefinition }
    } catch {
      // następny kandydat
    }
  }
  return { kind: 'invalid', message: 'To nie jest poprawny JSON' }
}

export const AUTO_DEFINITION: PriceSourceDefinition = { version: 1, strategy: 'auto' }

export const REFUSAL_HINTS: Record<string, string> = {
  blocked: 'AI widzi blokadę antybotową. Ustaw „Tylko przeglądarka” i wygeneruj prompt ponownie.',
  needs_js: 'Cena ładuje się JavaScriptem. Ustaw „Tylko przeglądarka” i wygeneruj prompt ponownie.',
  not_product_page: 'Link nie prowadzi do strony produktu. Wklej link do konkretnej oferty.',
  wrong_product: 'Na stronie jest inny produkt (np. inny wariant). Sprawdź link.',
  price_not_found: 'AI nie znalazło ceny na stronie.',
}
