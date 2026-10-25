import type { ScheduleConfig, ScheduledTask, ScheduleType } from '@myorg/shared'
import { pool, type Queryable } from '../../db'
import type { ScheduleDefinition } from './schedule'

interface TaskRow {
  id: string
  title: string
  description: string | null
  enabled: boolean
  action_type: string
  action_config: Record<string, unknown>
  schedule_type: ScheduleType
  schedule_config: ScheduleConfig
  start_at: Date
  end_at: Date | null
  timezone: string
  next_run_at: Date | null
  schedule_version: number
  created_at: Date
  updated_at: Date
}

/** Wewnętrzna reprezentacja zadania (daty jako Date, z wersją harmonogramu). */
export type TaskRecord = ScheduleDefinition & {
  id: string
  title: string
  description: string | null
  enabled: boolean
  actionType: string
  actionConfig: Record<string, unknown>
  nextRunAt: Date | null
  scheduleVersion: number
  createdAt: Date
  updatedAt: Date
}

export type TaskWrite = Omit<TaskRecord, 'id' | 'createdAt' | 'updatedAt'>

function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    enabled: row.enabled,
    actionType: row.action_type,
    actionConfig: row.action_config,
    scheduleType: row.schedule_type,
    scheduleConfig: row.schedule_config,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    scheduleVersion: row.schedule_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as TaskRecord
}

export function toDto(task: TaskRecord): ScheduledTask {
  return {
    id: task.id,
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
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function writeParams(task: TaskWrite): unknown[] {
  return [
    task.title,
    task.description,
    task.enabled,
    task.actionType,
    JSON.stringify(task.actionConfig),
    task.scheduleType,
    JSON.stringify(task.scheduleConfig),
    task.startAt,
    task.endAt,
    task.timezone,
    task.nextRunAt,
    task.scheduleVersion,
  ]
}

export class SchedulerRepository {
  async findAll(db: Queryable = pool): Promise<TaskRecord[]> {
    const result = await db.query<TaskRow>('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    return result.rows.map(toRecord)
  }

  async findById(id: string, db: Queryable = pool, options: { forUpdate?: boolean } = {}): Promise<TaskRecord | null> {
    const result = await db.query<TaskRow>(
      `SELECT * FROM scheduled_tasks WHERE id = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [id]
    )
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  /** Aktywne zadania z zaplanowanym terminem — do ponownej synchronizacji z kolejką. */
  async findPlanned(db: Queryable = pool): Promise<TaskRecord[]> {
    const result = await db.query<TaskRow>(
      'SELECT * FROM scheduled_tasks WHERE enabled AND next_run_at IS NOT NULL ORDER BY next_run_at'
    )
    return result.rows.map(toRecord)
  }

  async insert(task: TaskWrite, db: Queryable = pool): Promise<TaskRecord> {
    const result = await db.query<TaskRow>(
      `INSERT INTO scheduled_tasks
         (title, description, enabled, action_type, action_config, schedule_type, schedule_config,
          start_at, end_at, timezone, next_run_at, schedule_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      writeParams(task)
    )
    return toRecord(result.rows[0])
  }

  async update(id: string, task: TaskWrite, db: Queryable = pool): Promise<TaskRecord> {
    const result = await db.query<TaskRow>(
      `UPDATE scheduled_tasks SET
         title = $1, description = $2, enabled = $3, action_type = $4, action_config = $5,
         schedule_type = $6, schedule_config = $7, start_at = $8, end_at = $9, timezone = $10,
         next_run_at = $11, schedule_version = $12
       WHERE id = $13
       RETURNING *`,
      [...writeParams(task), id]
    )
    return toRecord(result.rows[0])
  }
}
