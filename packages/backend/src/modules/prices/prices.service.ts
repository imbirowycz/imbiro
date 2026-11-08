import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { CronScheduleConfig, IntervalScheduleConfig, PriceItem, PriceOfferKind, PriceOfferPage, PriceSchedule, PriceSourceDefinition } from '@myorg/shared'
import { withTransaction } from '../../db'
import { NotFoundError, ValidationError } from '../../errors'
import type { SchedulerService } from '../scheduler/scheduler.service'
import type { TaskRecord } from '../scheduler/scheduler.repository'
import { SchedulerRepository } from '../scheduler/scheduler.repository'
import { enqueuePriceCheck } from './price-queue'
import { PRICE_SOURCE_PROMPT_VERSION } from './price-prompt'
import { type ItemRecord, type ItemWrite, PricesRepository, type SourceRecord, toSourceDto } from './prices.repository'
import { parseInput, type SaveItemInput, saveItemSchema } from './prices.schemas'
import { assertDefinitionSelectors, type RepairContext } from './prices.tools'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PRICE_TIMEZONE = 'Europe/Warsaw'
export const PRICE_ACTION = 'price.watch'

export interface ItemListQuery {
  q?: string
  status?: 'problem' | 'ok'
  enabled?: boolean
}

/**
 * Artykuły Łowcy cen. Artykuł, jego źródła i zadanie schedulera zmieniają się zawsze w jednej
 * transakcji — usunięcie artykułu nie zostawia żadnych śladów (źródła, historia, okazje,
 * zadanie i historia jego wykonań).
 */
export class PricesService {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly repo = new PricesRepository(),
    private readonly tasks = new SchedulerRepository()
  ) {}

  async list(query: ItemListQuery = {}): Promise<PriceItem[]> {
    const items = await this.repo.listItems()
    const all = await this.hydrate(items)
    const q = query.q?.trim().toLowerCase()
    return all.filter((item) => {
      if (q && !`${item.name} ${item.description ?? ''} ${item.sources.map((s) => s.label).join(' ')}`.toLowerCase().includes(q)) return false
      if (query.enabled !== undefined && item.enabled !== query.enabled) return false
      if (query.status === 'problem' && item.summary.problemSources === 0) return false
      if (query.status === 'ok' && item.summary.problemSources > 0) return false
      return true
    })
  }

  async get(id: string): Promise<PriceItem> {
    assertUuid(id)
    const item = await this.repo.findItem(id)
    if (!item) throw new NotFoundError(`Artykuł ${id} nie istnieje`)
    return (await this.hydrate([item]))[0]
  }

  async create(input: unknown): Promise<PriceItem> {
    const body = this.parse(input)
    const id = randomUUID()
    await withTransaction(async (client) => {
      const task = await this.scheduler.createWithin(client, taskInput(id, body))
      await this.repo.insertItem(id, itemWrite(body), task.id, client)
      await this.saveSources(client, id, body, [])
    })
    return this.get(id)
  }

  async update(id: string, input: unknown): Promise<PriceItem> {
    assertUuid(id)
    const body = this.parse(input)
    await withTransaction(async (client) => {
      const item = await this.lock(id, client)
      await this.scheduler.updateWithin(client, item.scheduledTaskId, taskInput(id, body))
      await this.repo.updateItem(id, itemWrite(body), client)
      const existing = await this.repo.listSources([id], client)
      await this.saveSources(client, id, body, existing)
    })
    return this.get(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<PriceItem> {
    assertUuid(id)
    await withTransaction(async (client) => {
      const item = await this.lock(id, client)
      if (item.enabled === enabled) return
      await this.scheduler.updateWithin(client, item.scheduledTaskId, { enabled })
      await this.repo.setItemEnabled(id, enabled, client)
    })
    return this.get(id)
  }

  async delete(id: string): Promise<void> {
    assertUuid(id)
    await withTransaction(async (client) => {
      const item = await this.lock(id, client)
      // Najpierw artykuł (kaskada: źródła, historia, okazje, zrzuty), potem jego zadanie.
      await this.repo.deleteItem(id, client)
      await this.scheduler.deleteWithin(client, item.scheduledTaskId)
    })
  }

  /** „Sprawdź teraz”: wszystkie źródła od razu, bez losowego opóźnienia. */
  async checkNow(id: string): Promise<{ enqueued: number; sources: number }> {
    const item = await this.get(id)
    let enqueued = 0
    for (const source of item.sources) {
      if (await enqueuePriceCheck({ sourceId: source.id, reason: 'now' })) enqueued++
    }
    return { enqueued, sources: item.sources.length }
  }

  async repairContext(sourceId: string): Promise<RepairContext | null> {
    if (!UUID_RE.test(sourceId)) return null
    const source = await this.repo.findSource(sourceId)
    if (!source) return null
    return { lastError: source.lastError, lastGoodPrice: source.lastPrice, definition: source.definition }
  }

  async history(sourceId: string, limit = 200) {
    assertUuid(sourceId)
    const source = await this.repo.findSource(sourceId)
    if (!source) throw new NotFoundError(`Źródło ${sourceId} nie istnieje`)
    return this.repo.history(sourceId, limit)
  }

  async lastSnapshot(sourceId: string) {
    assertUuid(sourceId)
    const snapshot = await this.repo.latestSnapshot(sourceId)
    if (!snapshot) throw new NotFoundError('Brak zapisanego HTML dla tego źródła')
    return { ...snapshot, createdAt: snapshot.createdAt.toISOString() }
  }

  // ---------- okazje ----------

  async listOffers(raw: Record<string, unknown>): Promise<PriceOfferPage> {
    const limit = Math.min(Math.max(Number(raw.limit) || 50, 1), 200)
    const kind = typeof raw.kind === 'string' && OFFER_KINDS.has(raw.kind) ? (raw.kind as PriceOfferKind) : undefined
    const itemId = typeof raw.itemId === 'string' && UUID_RE.test(raw.itemId) ? raw.itemId : undefined
    const date = (v: unknown) => {
      if (typeof v !== 'string' || !v) return undefined
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? undefined : d
    }
    let cursor: { detectedAt: Date; id: string } | undefined
    if (typeof raw.cursor === 'string' && raw.cursor) {
      const [at, id] = Buffer.from(raw.cursor, 'base64url').toString('utf8').split('|')
      const detectedAt = new Date(at)
      if (!Number.isNaN(detectedAt.getTime()) && UUID_RE.test(id ?? '')) cursor = { detectedAt, id }
    }
    const offers = await this.repo.listOffers({
      itemId,
      kind,
      unread: raw.unread === 'true' || raw.unread === '1',
      from: date(raw.from),
      to: date(raw.to),
      q: typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 100) : undefined,
      cursor,
      limit: limit + 1,
    })
    const page = offers.slice(0, limit)
    const last = page[page.length - 1]
    return {
      offers: page,
      nextCursor: offers.length > limit && last ? Buffer.from(`${last.detectedAt}|${last.id}`).toString('base64url') : null,
    }
  }

  async markRead(input: unknown): Promise<{ updated: number }> {
    const ids = idsOrAll(input)
    return { updated: await this.repo.markRead(ids) }
  }

  async dismiss(input: unknown): Promise<{ updated: number }> {
    const ids = idsOrAll(input)
    if (ids === 'all') throw new ValidationError('Podaj listę okazji do usunięcia')
    return { updated: await this.repo.dismiss(ids) }
  }

  async unreadCount(): Promise<{ unread: number }> {
    return { unread: await this.repo.unreadCount() }
  }

  private parse(input: unknown): SaveItemInput {
    const body = parseInput(saveItemSchema, input, 'Niepoprawny artykuł')
    body.sources.forEach((source, index) => assertDefinitionSelectors(source.definition as PriceSourceDefinition, `sources.${index}.definition`))
    if (body.schedule.kind === 'cron' && body.schedule.cron && body.schedule.cron.trim().split(/\s+/).length !== 5) {
      throw new ValidationError('Niepoprawny artykuł', [{ path: 'schedule.cron', message: 'Wyrażenie cron ma 5 pól' }])
    }
    return body
  }

  private async lock(id: string, client: PoolClient): Promise<ItemRecord> {
    const item = await this.repo.findItem(id, client, true)
    if (!item) throw new NotFoundError(`Artykuł ${id} nie istnieje`)
    return item
  }

  private async saveSources(client: PoolClient, itemId: string, body: SaveItemInput, existing: SourceRecord[]): Promise<void> {
    const existingIds = new Set(existing.map((s) => s.id))
    const keep: string[] = []
    for (const [position, source] of body.sources.entries()) {
      const definition = { ...source.definition, promptVersion: source.definition.promptVersion ?? PRICE_SOURCE_PROMPT_VERSION } as PriceSourceDefinition
      const write = { label: source.label, url: source.url, fetchMode: source.fetchMode, definition, position }
      if (source.id && existingIds.has(source.id)) {
        await this.repo.updateSource(source.id, write, client)
        keep.push(source.id)
      } else {
        keep.push(await this.repo.insertSource(itemId, write, client))
      }
    }
    // Źródła usunięte z formularza znikają razem z historią i okazjami (kaskada).
    await this.repo.deleteSourcesExcept(itemId, keep, client)
  }

  private async hydrate(items: ItemRecord[]): Promise<PriceItem[]> {
    if (items.length === 0) return []
    const ids = items.map((i) => i.id)
    const [sources, counts, tasks] = await Promise.all([
      this.repo.listSources(ids),
      this.repo.offerCounts(),
      Promise.all(items.map((i) => this.tasks.findById(i.scheduledTaskId))),
    ])
    const taskById = new Map(tasks.filter((t): t is TaskRecord => !!t).map((t) => [t.id, t]))
    return items.map((item) => {
      const own = sources.filter((s) => s.itemId === item.id)
      const priced = own.filter((s) => s.lastPrice !== null && s.lastAvailable !== false)
      const best = priced.reduce<SourceRecord | null>((acc, s) => (!acc || (s.lastPrice ?? Infinity) < (acc.lastPrice ?? Infinity) ? s : acc), null)
      const lastChecked = own.reduce<Date | null>((acc, s) => (s.lastCheckedAt && (!acc || s.lastCheckedAt > acc) ? s.lastCheckedAt : acc), null)
      const task = taskById.get(item.scheduledTaskId)
      const count = counts.get(item.id)
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        ean: item.ean,
        targetPrice: item.targetPrice,
        minDropPct: item.minDropPct,
        enabled: item.enabled,
        notify: {
          telegram: item.notifyTelegram,
          telegramChatId: item.telegramChatId,
          email: item.notifyEmail,
          emailTo: item.emailTo,
        },
        schedule: scheduleFromTask(task, item.jitterMinutes),
        nextRunAt: task?.nextRunAt?.toISOString() ?? null,
        scheduledTaskId: item.scheduledTaskId,
        sources: own.map(toSourceDto),
        summary: {
          bestPrice: best?.lastPrice ?? null,
          bestSourceId: best?.id ?? null,
          bestSourceLabel: best?.label ?? null,
          currency: best?.lastCurrency ?? 'PLN',
          lastCheckedAt: lastChecked?.toISOString() ?? null,
          problemSources: own.filter((s) => s.status === 'warning' || s.status === 'failing' || s.status === 'blocked').length,
          activeOffers: count?.visible ?? 0,
          unreadOffers: count?.unread ?? 0,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }
    })
  }
}

const OFFER_KINDS = new Set(['price_drop', 'promo', 'target_reached', 'back_in_stock', 'lowest_30d'])

function idsOrAll(input: unknown): string[] | 'all' {
  const body = (input ?? {}) as { ids?: unknown; all?: unknown }
  if (body.all === true) return 'all'
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500 || !body.ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
    throw new ValidationError('Niepoprawne dane', [{ path: 'ids', message: 'Lista identyfikatorów okazji (UUID)' }])
  }
  return body.ids as string[]
}

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new NotFoundError(`${id} nie istnieje`)
}

function itemWrite(body: SaveItemInput): ItemWrite {
  return {
    name: body.name,
    description: body.description,
    ean: body.ean,
    targetPrice: body.targetPrice,
    minDropPct: body.minDropPct,
    enabled: body.enabled,
    notifyTelegram: body.notify.telegram,
    telegramChatId: body.notify.telegramChatId,
    notifyEmail: body.notify.email,
    emailTo: body.notify.emailTo,
    jitterMinutes: body.schedule.jitterMinutes,
  }
}

/** Zadanie schedulera „należące” do artykułu. */
export function taskInput(itemId: string, body: SaveItemInput): Record<string, unknown> {
  const isCron = body.schedule.kind === 'cron'
  return {
    title: `Łowca cen: ${body.name}`.slice(0, 200),
    description: 'Zarządzane przez moduł Łowca cen — edytuj w zakładce Ceny.',
    enabled: body.enabled,
    actionType: PRICE_ACTION,
    actionConfig: { itemId },
    scheduleType: body.schedule.kind,
    scheduleConfig: isCron ? { expression: body.schedule.cron } : { everySeconds: (body.schedule.everyHours ?? 24) * 3600 },
    timezone: PRICE_TIMEZONE,
  }
}

export function scheduleFromTask(task: TaskRecord | undefined, jitterMinutes: number): PriceSchedule {
  if (task?.scheduleType === 'interval') {
    return { kind: 'interval', everyHours: Math.round((task.scheduleConfig as IntervalScheduleConfig).everySeconds / 3600), jitterMinutes }
  }
  const cron = task ? (task.scheduleConfig as CronScheduleConfig).expression : '0 7,12,19 * * *'
  return { kind: 'cron', cron, jitterMinutes }
}
