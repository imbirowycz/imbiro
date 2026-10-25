import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { ScheduledTask, TaskExecution } from '@myorg/shared'
import { bossDb } from '../../boss'
import { withTransaction } from '../../db'
import { ConflictError, NotFoundError, ValidationError } from '../../errors'
import { actionRegistry, type ActionRegistry } from './actions'
import { initialRunAt } from './schedule'
import { ExecutionRepository, toExecutionDto } from './execution.repository'
import { enqueueManualRun, enqueueSlot, syncSlot } from './scheduler.planner'
import { SchedulerRepository, toDto, type TaskRecord, type TaskWrite } from './scheduler.repository'
import { assertPatchShape, parseTaskDefinition, type TaskDefinition } from './scheduler.validation'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Zarządzanie definicjami zadań. Każda zmiana zadania i odpowiadająca jej zmiana w kolejce
 * pg-boss są zapisywane w jednej transakcji, więc nie da się zostać z zadaniem bez joba
 * (albo z jobem bez zadania) po błędzie w połowie operacji.
 */
export class SchedulerService {
  constructor(
    private readonly boss: PgBoss,
    private readonly actions: ActionRegistry = actionRegistry,
    private readonly repository = new SchedulerRepository(),
    private readonly executions = new ExecutionRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(): Promise<ScheduledTask[]> {
    return (await this.repository.findAll()).map(toDto)
  }

  async get(id: string): Promise<ScheduledTask> {
    return toDto(await this.getRecord(id))
  }

  async getRecord(id: string): Promise<TaskRecord> {
    assertUuid(id)
    const task = await this.repository.findById(id)
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    return task
  }

  async create(input: unknown): Promise<ScheduledTask> {
    const now = this.now()
    const body = assertPatchShape(input)
    // Dla cron/interval brak startAt = od teraz; dla once termin musi być podany wprost.
    if (body.startAt === undefined && body.scheduleType !== 'once') {
      body.startAt = now.toISOString()
    }
    const definition = this.parseDefinition(body)
    const nextRunAt = this.planOrReject(definition, now)

    return withTransaction(async (client) => {
      const created = await this.repository.insert(
        { ...definition, nextRunAt, scheduleVersion: 1 },
        client
      )
      await syncSlot(this.boss, null, created, bossDb(client))
      return toDto(created)
    })
  }

  async update(id: string, input: unknown): Promise<ScheduledTask> {
    assertUuid(id)
    const patch = assertPatchShape(input)
    if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to update')

    return withTransaction(async (client) => {
      const previous = await this.lockTask(id, client)
      // Zmiana typu harmonogramu bez nowej konfiguracji nie może dziedziczyć starej.
      if (patch.scheduleType !== undefined && patch.scheduleType !== previous.scheduleType && patch.scheduleConfig === undefined) {
        throw new ValidationError('Invalid task definition', [
          { path: 'scheduleConfig', message: 'Required when scheduleType changes' },
        ])
      }
      // Zmiana typu akcji bez nowej konfiguracji też nie dziedziczy starej.
      const merged = { ...toInput(previous), ...patch }
      if (patch.actionType !== undefined && patch.actionType !== previous.actionType && patch.actionConfig === undefined) {
        merged.actionConfig = {}
      }
      const definition = this.parseDefinition(merged)
      const next = this.applyDefinition(previous, definition)
      const updated = await this.repository.update(id, next, client)
      await syncSlot(this.boss, previous, updated, bossDb(client))
      return toDto(updated)
    })
  }

  async enable(id: string): Promise<ScheduledTask> {
    assertUuid(id)
    return withTransaction(async (client) => {
      const previous = await this.lockTask(id, client)
      if (previous.enabled) return toDto(previous)

      const nextRunAt = initialRunAt(previous, this.now())
      if (!nextRunAt) {
        throw new ConflictError('Task has no future run in its schedule; change startAt/endAt first')
      }
      const updated = await this.repository.update(
        id,
        { ...previous, enabled: true, nextRunAt, scheduleVersion: previous.scheduleVersion + 1 },
        client
      )
      await syncSlot(this.boss, previous, updated, bossDb(client))
      return toDto(updated)
    })
  }

  async disable(id: string): Promise<ScheduledTask> {
    assertUuid(id)
    return withTransaction(async (client) => {
      const previous = await this.lockTask(id, client)
      if (!previous.enabled) return toDto(previous)

      const updated = await this.repository.update(
        id,
        { ...previous, enabled: false, nextRunAt: null, scheduleVersion: previous.scheduleVersion + 1 },
        client
      )
      await syncSlot(this.boss, previous, updated, bossDb(client))
      return toDto(updated)
    })
  }

  /**
   * Ręczne uruchomienie: rekord wykonania i job powstają w jednej transakcji, a job trafia do tej
   * samej kolejki i executora co terminy z harmonogramu. Działa także dla wyłączonego zadania
   * i nie zmienia jego harmonogramu.
   */
  async runNow(id: string): Promise<TaskExecution> {
    const task = await this.getRecord(id)
    return withTransaction(async (client) => {
      const jobId = randomUUID()
      const execution = await this.executions.insertManual(task.id, this.now(), jobId, client)
      await enqueueManualRun(this.boss, task.id, execution.id, jobId, bossDb(client))
      return toExecutionDto(execution)
    })
  }

  async listExecutions(id: string, limit = 50): Promise<TaskExecution[]> {
    const task = await this.getRecord(id)
    return (await this.executions.listByTask(task.id, limit)).map(toExecutionDto)
  }

  /**
   * Ponownie wysyła joby dla wszystkich zaplanowanych terminów. Idempotentne: termin, który
   * już czeka w kolejce, zostaje pominięty przez pg-boss. Odtwarza joby utracone np. przez
   * ręczne czyszczenie kolejki. Zwraca liczbę nowo dodanych jobów.
   */
  async reconcile(): Promise<number> {
    let enqueued = 0
    for (const task of await this.repository.findPlanned()) {
      if (await enqueueSlot(this.boss, task)) enqueued++
    }
    return enqueued
  }

  /** Walidacja definicji i konfiguracji akcji (z rejestru); zapisujemy znormalizowaną konfigurację. */
  private parseDefinition(input: Record<string, unknown>): TaskDefinition {
    const definition = parseTaskDefinition(input)
    const actionConfig = this.actions.validateConfig(definition.actionType, definition.actionConfig)
    return { ...definition, actionConfig: actionConfig as Record<string, unknown> }
  }

  private async lockTask(id: string, client: PoolClient): Promise<TaskRecord> {
    const task = await this.repository.findById(id, client, { forUpdate: true })
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    return task
  }

  /**
   * Nowy stan zadania po edycji. Termin i wersja harmonogramu zmieniają się tylko wtedy,
   * gdy zmienił się harmonogram albo aktywność — edycja np. tytułu nie przesuwa terminu.
   */
  private applyDefinition(previous: TaskRecord, definition: TaskDefinition): TaskWrite {
    const scheduleChanged =
      previous.enabled !== definition.enabled ||
      previous.scheduleType !== definition.scheduleType ||
      JSON.stringify(previous.scheduleConfig) !== JSON.stringify(definition.scheduleConfig) ||
      previous.startAt.getTime() !== definition.startAt.getTime() ||
      (previous.endAt?.getTime() ?? null) !== (definition.endAt?.getTime() ?? null) ||
      previous.timezone !== definition.timezone

    if (!scheduleChanged) {
      return { ...definition, nextRunAt: previous.nextRunAt, scheduleVersion: previous.scheduleVersion }
    }
    return {
      ...definition,
      nextRunAt: this.planOrReject(definition, this.now()),
      scheduleVersion: previous.scheduleVersion + 1,
    }
  }

  /** Termin dla aktywnego zadania; aktywne zadanie bez żadnego przyszłego terminu to błąd danych. */
  private planOrReject(definition: TaskDefinition, now: Date): Date | null {
    if (!definition.enabled) return null
    const nextRunAt = initialRunAt(definition, now)
    if (!nextRunAt) {
      throw new ValidationError('Invalid task definition', [
        {
          path: definition.scheduleType === 'once' ? 'startAt' : 'endAt',
          message: 'Schedule has no future run',
        },
      ])
    }
    return nextRunAt
  }
}

function assertUuid(id: string): void {
  // Zły format id = brak zadania, a nie błąd bazy.
  if (!UUID_RE.test(id)) throw new NotFoundError(`Task ${id} not found`)
}

/** Zadanie w kształcie wejścia API — baza do scalenia z PATCH. */
function toInput(task: TaskRecord): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description,
    enabled: task.enabled,
    actionType: task.actionType,
    actionConfig: task.actionConfig,
    scheduleType: task.scheduleType,
    scheduleConfig: task.scheduleConfig,
    startAt: task.startAt.toISOString(),
    endAt: task.endAt?.toISOString() ?? null,
    timezone: task.timezone,
  }
}
