import type { PriceDiscoveryResult, PricePromptResult, PriceSnapshot, PriceSourceDefinition, PriceSourceTestResult } from '@myorg/shared'
import { AppError, ValidationError } from '../../errors'
import { checkSource, fetchPage, toTestResult } from './price-check'
import { discoverSources } from './price-discover'
import { assertSelectorsValid, DefinitionError } from './price-extract'
import { toFetchError } from './price-fetch'
import { cleanHtmlForPrompt } from './price-html'
import { buildPricePrompt, PRICE_SOURCE_PROMPT_VERSION } from './price-prompt'
import { discoverSchema, parseInput, promptSchema, snapshotSchema, testSourceSchema } from './prices.schemas'

// Narzędzia formularza źródła: „Sprawdź źródło”, „Pobierz HTML dla AI”, „Kopiuj prompt”.
// Nic nie zapisują w bazie.

const AUTO_DEFINITION: PriceSourceDefinition = { version: 1, strategy: 'auto' }

export interface RepairContext {
  lastError: string | null
  lastGoodPrice: number | null
  definition: unknown
}

export class PriceTools {
  constructor(private readonly repairContext: (sourceId: string) => Promise<RepairContext | null> = async () => null) {}

  async testSource(input: unknown, signal?: AbortSignal): Promise<PriceSourceTestResult> {
    const body = parseInput(testSourceSchema, input)
    const definition = (body.definition ?? AUTO_DEFINITION) as PriceSourceDefinition
    assertDefinitionSelectors(definition)
    const outcome = await checkSource({ url: body.url, mode: body.fetchMode, definition, signal })
    return toTestResult(outcome)
  }

  /** „Znajdź źródła”: Ceneo + wyszukiwarki sklepów. Trwa do ~2,5 min. */
  async discover(input: unknown, signal?: AbortSignal): Promise<PriceDiscoveryResult> {
    const body = parseInput(discoverSchema, input)
    return discoverSources({ name: body.name, ean: body.ean, existingUrls: body.existingUrls, signal })
  }

  async snapshot(input: unknown, signal?: AbortSignal): Promise<PriceSnapshot> {
    const body = parseInput(snapshotSchema, input)
    let page
    try {
      page = await fetchPage(body.url, body.fetchMode, signal)
    } catch (err) {
      // Błąd sklepu, nie naszego API — 502 z czytelnym komunikatem.
      throw new AppError(toFetchError(err, signal).message, 502)
    }
    const cleaned = cleanHtmlForPrompt(page.html, page.finalUrl)
    return {
      url: body.url,
      finalUrl: page.finalUrl,
      fetcher: page.fetcher,
      httpStatus: page.status,
      html: cleaned.html,
      jsonLd: cleaned.jsonLd,
      truncated: cleaned.truncated,
    }
  }

  async prompt(input: unknown, signal?: AbortSignal): Promise<PricePromptResult> {
    const body = parseInput(promptSchema, input)
    let snapshot: PricePromptResult['snapshot'] = null
    let fetchError: PricePromptResult['fetchError'] = null
    let html = ''
    let jsonLd: string[] = []
    let fetcher = '(nie pobrano)'
    let httpStatus: number | string = '(brak)'
    try {
      const page = await fetchPage(body.url, body.fetchMode, signal)
      const cleaned = cleanHtmlForPrompt(page.html, page.finalUrl)
      html = cleaned.html
      jsonLd = cleaned.jsonLd
      fetcher = page.fetcher
      httpStatus = page.status
      snapshot = { fetcher: page.fetcher, httpStatus: page.status, truncated: cleaned.truncated }
    } catch (err) {
      const error = toFetchError(err, signal)
      if (signal?.aborted) throw error
      fetchError = { code: error.code, message: error.message }
      httpStatus = error.status ?? '(brak)'
      html = `(Nie udało się pobrać strony: ${error.message}. Jeśli możesz, otwórz ${body.url} samodzielnie i przeanalizuj jej HTML; w przeciwnym razie zwróć obiekt błędu "blocked".)`
    }

    const repair = body.mode === 'repair' && body.sourceId ? await this.repairContext(body.sourceId) : null
    const prompt = buildPricePrompt({
      mode: body.mode,
      itemName: body.item.name,
      itemDescription: body.item.description,
      itemEan: body.item.ean,
      shop: body.shop,
      url: body.url,
      fetcher,
      httpStatus,
      jsonLd,
      html,
      currentDefinition: body.currentDefinition ?? repair?.definition,
      lastError: repair?.lastError,
      lastGoodPrice: repair?.lastGoodPrice,
    })
    return { prompt, promptVersion: PRICE_SOURCE_PROMPT_VERSION, snapshot, fetchError }
  }
}

export function assertDefinitionSelectors(definition: PriceSourceDefinition, path = 'definition'): void {
  try {
    assertSelectorsValid(definition)
  } catch (err) {
    if (err instanceof DefinitionError) throw new ValidationError('Niepoprawna definicja źródła', [{ path, message: err.message }])
    throw err
  }
}
