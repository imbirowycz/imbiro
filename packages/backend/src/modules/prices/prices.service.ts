import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type {
  CronScheduleConfig,
  IntervalScheduleConfig,
  PriceChange,
  PriceCollectorStatus,
  PriceItem,
  PriceOverview,
  PriceSchedule,
  PriceSourceDefinition,
} from '@myorg/shared'
import { withTransaction } from '../../core/db'
import { NotFoundError, ValidationError } from '../../core/errors'
import type { SchedulerService, TaskRepository } from '../scheduler'
import { assertSelectorsValid, DefinitionError } from './price-extract'
import { PRICE_SHOPS } from './price.catalog'
import type { PriceQueue } from './price-queue'
import { PRICE_WATCH_ACTION } from './price-watch.action'
import { type ItemRecord, type ItemWrite, type PricesRepository, type SourceRecord, toSourceDto } from './prices.repository'
import { newSourceSchema, parseInput, type SaveItemInput, saveItemSchema } from './prices.schemas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PRICE_TIMEZONE = 'Europe/Warsaw'

type TaskRecord = NonNullable<Awaited<ReturnType<TaskRepository['findById']>>>

/**
 * Tracked items. An item, its sources and its scheduler task always change in one
 * transaction — deleting an item leaves no trace (sources, history, offers, the task and
 * the history of its runs).
 */
export class PricesService {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly tasks: TaskRepository,
    private readonly repo: PricesRepository,
    private readonly queue: PriceQueue,
    private readonly onlineWithinSeconds: number,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Everything the "Okazje" page shows: the collector state, known shops and all items. */
  async overview(): Promise<PriceOverview> {
    const [items, collector] = await Promise.all([this.repo.listItems().then((list) => this.hydrate(list)), this.collectorStatus()])
    return { collector, shops: [...PRICE_SHOPS], items }
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
      // The item first (cascade: sources, history, offers, snapshots), then its task.
      await this.repo.deleteItem(id, client)
      await this.scheduler.deleteWithin(client, item.scheduledTaskId)
    })
  }

  /** "Check now": every enabled source right away, without the random delay. */
  async checkNow(id: string): Promise<{ enqueued: number; sources: number }> {
    const item = await this.get(id)
    const sources = item.sources.filter((source) => source.enabled)
    let enqueued = 0
    for (const source of sources) {
      if (await this.queue.enqueue({ sourceId: source.id, reason: 'now' })) enqueued++
    }
    return { enqueued, sources: sources.length }
  }

  async changes(id: string, limit = 200): Promise<PriceChange[]> {
    await this.get(id)
    return this.repo.listChanges(id, limit)
  }

  // ---------- single sources (managed from the item popup) ----------

  /** Adds a source and checks it right away. */
  async addSource(itemId: string, input: unknown): Promise<PriceItem> {
    assertUuid(itemId)
    const body = parseInput(newSourceSchema, input, 'Niepoprawne źródło')
    const definition = body.definition as PriceSourceDefinition
    assertDefinition(definition, 'definition')
    if (!(await this.repo.findItem(itemId))) throw new NotFoundError(`Artykuł ${itemId} nie istnieje`)
    const position = await this.repo.nextSourcePosition(itemId)
    const sourceId = await this.repo.insertSource(itemId, { label: body.label, url: body.url, enabled: body.enabled, definition, position })
    if (body.enabled) await this.queue.enqueue({ sourceId, reason: 'now' })
    return this.get(itemId)
  }

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<PriceItem> {
    const source = await this.source(sourceId)
    await this.repo.setSourceEnabled(source.id, enabled)
    return this.get(source.itemId)
  }

  async deleteSource(sourceId: string): Promise<PriceItem> {
    const source = await this.source(sourceId)
    await this.repo.deleteSource(source.id)
    return this.get(source.itemId)
  }

  private async source(sourceId: string): Promise<SourceRecord> {
    assertUuid(sourceId)
    const source = await this.repo.findSource(sourceId)
    if (!source) throw new NotFoundError(`Źródło ${sourceId} nie istnieje`)
    return source
  }

  private async collectorStatus(): Promise<PriceCollectorStatus> {
    const [state, queued] = await Promise.all([this.repo.collectorState(), this.queue.queuedCount()])
    return {
      lastSeenAt: state?.lastSeenAt.toISOString() ?? null,
      hostname: state?.hostname ?? null,
      online: !!state && this.now().getTime() - state.lastSeenAt.getTime() <= this.onlineWithinSeconds * 1000,
      queued,
    }
  }

  private parse(input: unknown): SaveItemInput {
    const body = parseInput(saveItemSchema, input, 'Niepoprawny artykuł')
    body.sources.forEach((source, index) => assertDefinition(source.definition as PriceSourceDefinition, `sources.${index}.definition`))
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
      const write = { label: source.label, url: source.url, enabled: source.enabled, definition: source.definition as PriceSourceDefinition, position }
      if (source.id && existingIds.has(source.id)) {
        await this.repo.updateSource(source.id, write, client)
        keep.push(source.id)
      } else {
        keep.push(await this.repo.insertSource(itemId, write, client))
      }
    }
    // Sources removed from the form disappear together with their history and offers (cascade).
    await this.repo.deleteSourcesExcept(itemId, keep, client)
  }

  private async hydrate(items: ItemRecord[]): Promise<PriceItem[]> {
    if (items.length === 0) return []
    const [sources, tasks] = await Promise.all([
      this.repo.listSources(items.map((i) => i.id)),
      Promise.all(items.map((i) => this.tasks.findById(i.scheduledTaskId))),
    ])
    const taskById = new Map(tasks.filter((t): t is TaskRecord => !!t).map((t) => [t.id, t]))
    return items.map((item) => {
      const own = sources.filter((s) => s.itemId === item.id)
      const active = own.filter((s) => s.enabled)
      const priced = active.filter((s) => s.lastPrice !== null && s.lastAvailable !== false)
      const best = priced.reduce<SourceRecord | null>((acc, s) => (!acc || (s.lastPrice ?? Infinity) < (acc.lastPrice ?? Infinity) ? s : acc), null)
      const lastChecked = own.reduce<Date | null>((acc, s) => (s.lastCheckedAt && (!acc || s.lastCheckedAt > acc) ? s.lastCheckedAt : acc), null)
      const task = taskById.get(item.scheduledTaskId)
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
          okSources: active.filter((s) => s.status === 'ok').length,
          problemSources: active.filter((s) => s.status === 'warning' || s.status === 'failing' || s.status === 'blocked').length,
          targetReached: item.targetPrice !== null && best?.lastPrice != null && best.lastPrice <= item.targetPrice,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }
    })
  }
}

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new NotFoundError(`${id} nie istnieje`)
}

function assertDefinition(definition: PriceSourceDefinition, path: string): void {
  try {
    assertSelectorsValid(definition)
  } catch (err) {
    if (err instanceof DefinitionError) throw new ValidationError('Niepoprawna definicja źródła', [{ path, message: err.message }])
    throw err
  }
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

/** The scheduler task "owned" by the item. */
export function taskInput(itemId: string, body: SaveItemInput): Record<string, unknown> {
  const isCron = body.schedule.kind === 'cron'
  return {
    title: `Okazje: ${body.name}`.slice(0, 200),
    description: 'Zarządzane przez zakładkę Okazje — tam zmieniaj harmonogram.',
    enabled: body.enabled,
    actionType: PRICE_WATCH_ACTION,
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
