import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { PgBoss } from 'pg-boss'
import type { ApiErrorDetail, ScheduledTask, TaskExecution } from '@myorg/shared'
import { bossDb } from '../../core/boss'
import { withTransaction } from '../../core/db'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors'
import type { ActionRegistry } from './actions/action.registry'
import { initialRunAt } from './schedule.rules'
import { ExecutionRepository, toExecutionDto } from './execution.repository'
import { cancelSlot, enqueueManualRun, enqueueSlot, syncSlot } from './task.queue'
import { TaskRepository, toTaskDto, type TaskRecord, type TaskWrite } from './task.repository'
import { assertEditableFields, parseTaskDefinition, type TaskDefinition } from './task.validation'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Manages task definitions. Every task change and the matching change in the pg-boss
 * queue are written in one transaction, so a failure halfway cannot leave a task without a job
 * (or a job without a task).
 */
export class SchedulerService {
  constructor(
    private readonly boss: PgBoss,
    private readonly actions: ActionRegistry,
    private readonly repository: TaskRepository,
    private readonly executions: ExecutionRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(): Promise<ScheduledTask[]> {
    return (await this.repository.findAll()).map(toTaskDto)
  }

  async get(id: string): Promise<ScheduledTask> {
    return toTaskDto(await this.getRecord(id))
  }

  async getRecord(id: string): Promise<TaskRecord> {
    assertUuid(id)
    const task = await this.repository.findById(id)
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    return task
  }

  async create(input: unknown): Promise<ScheduledTask> {
    return withTransaction((client) => this.createWithin(client, input))
  }

  /**
   * Creates a task inside the caller's transaction — for a module that owns "its" task
   * (e.g. prices) and must change the task together with its own rows.
   */
  async createWithin(client: PoolClient, input: unknown): Promise<ScheduledTask> {
    const now = this.now()
    const body = assertEditableFields(input)
    // For cron/interval a missing startAt = from now; for once the time must be given explicitly.
    if (body.startAt === undefined && body.scheduleType !== 'once') {
      body.startAt = now.toISOString()
    }
    const definition = this.parseDefinition(body)
    const nextRunAt = this.planOrReject(definition, now)
    const created = await this.repository.insert({ ...definition, nextRunAt, scheduleVersion: 1 }, client)
    await syncSlot(this.boss, null, created, bossDb(client))
    return toTaskDto(created)
  }

  async update(id: string, input: unknown): Promise<ScheduledTask> {
    return withTransaction((client) => this.updateWithin(client, id, input))
  }

  /** Edits a task inside the caller's transaction (see createWithin). */
  async updateWithin(client: PoolClient, id: string, input: unknown): Promise<ScheduledTask> {
    assertUuid(id)
    const patch = assertEditableFields(input)
    if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to update')

    const previous = await this.lockTask(id, client)
    // A changed schedule type without a new config must not inherit the old one.
    if (patch.scheduleType !== undefined && patch.scheduleType !== previous.scheduleType && patch.scheduleConfig === undefined) {
      throw new ValidationError('Invalid task definition', [
        { path: 'scheduleConfig', message: 'Required when scheduleType changes' },
      ])
    }
    // A changed action type without a new config does not inherit the old one either.
    const merged = { ...toInput(previous), ...patch }
    if (patch.actionType !== undefined && patch.actionType !== previous.actionType && patch.actionConfig === undefined) {
      merged.actionConfig = {}
    }
    const definition = this.parseDefinition(merged)
    const next = this.applyDefinition(previous, definition)
    const updated = await this.repository.update(id, next, client)
    await syncSlot(this.boss, previous, updated, bossDb(client))
    return toTaskDto(updated)
  }

  /**
   * Deletes a task inside the caller's transaction: cancels its waiting job; the execution
   * history goes with it (cascade). A job already running is skipped by the executor.
   */
  async deleteWithin(client: PoolClient, id: string): Promise<void> {
    assertUuid(id)
    const previous = await this.repository.findById(id, client, { forUpdate: true })
    if (!previous) return
    await cancelSlot(this.boss, previous, bossDb(client))
    await this.repository.delete(id, client)
  }

  async enable(id: string): Promise<ScheduledTask> {
    assertUuid(id)
    return withTransaction(async (client) => {
      const previous = await this.lockTask(id, client)
      if (previous.enabled) return toTaskDto(previous)

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
      return toTaskDto(updated)
    })
  }

  async disable(id: string): Promise<ScheduledTask> {
    assertUuid(id)
    return withTransaction(async (client) => {
      const previous = await this.lockTask(id, client)
      if (!previous.enabled) return toTaskDto(previous)

      const updated = await this.repository.update(
        id,
        { ...previous, enabled: false, nextRunAt: null, scheduleVersion: previous.scheduleVersion + 1 },
        client
      )
      await syncSlot(this.boss, previous, updated, bossDb(client))
      return toTaskDto(updated)
    })
  }

  /**
   * Manual run: the execution record and the job are created in one transaction, and the job goes to
   * the same queue and executor as scheduled runs. It also works for a disabled task
   * and does not change its schedule.
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
   * Re-sends jobs for all planned runs. Idempotent: a run that already
   * waits in the queue is skipped by pg-boss. Restores jobs lost e.g. by
   * a manual queue purge. Returns the number of newly added jobs.
   */
  async reconcile(): Promise<number> {
    let enqueued = 0
    for (const task of await this.repository.findPlanned()) {
      if (await enqueueSlot(this.boss, task)) enqueued++
    }
    return enqueued
  }

  /**
   * Validates the definition and the action config (from the registry); the normalized config is stored.
   * Both parts are always checked, so the client gets all errors in one response.
   */
  private parseDefinition(input: Record<string, unknown>): TaskDefinition {
    const details: ApiErrorDetail[] = []
    const collect = (fn: () => void) => {
      try {
        fn()
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err
        details.push(...(err.details ?? [{ path: '(root)', message: err.message }]))
      }
    }

    let definition: TaskDefinition | undefined
    let actionConfig: unknown
    collect(() => {
      definition = parseTaskDefinition(input)
    })
    collect(() => {
      actionConfig = this.actions.validateConfig(String(input.actionType ?? ''), input.actionConfig ?? {})
    })

    if (details.length > 0 || !definition) {
      // A bad actionType is reported by both parts — keep the first message for a given field.
      const unique = details.filter((d, i) => details.findIndex((other) => other.path === d.path) === i)
      throw new ValidationError('Invalid task definition', unique)
    }
    return { ...definition, actionConfig: actionConfig as Record<string, unknown> }
  }

  private async lockTask(id: string, client: PoolClient): Promise<TaskRecord> {
    const task = await this.repository.findById(id, client, { forUpdate: true })
    if (!task) throw new NotFoundError(`Task ${id} not found`)
    return task
  }

  /**
   * New task state after an edit. The run time and the schedule version change only when
   * the schedule or the enabled flag changed — editing e.g. the title does not move the run.
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

  /** Run time for an enabled task; an enabled task without any future run is a data error. */
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
  // A malformed id = no such task, not a database error.
  if (!UUID_RE.test(id)) throw new NotFoundError(`Task ${id} not found`)
}

/** The task in the shape of API input — the base that a PATCH is merged into. */
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
