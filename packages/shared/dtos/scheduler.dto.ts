import type { ScheduleConfig, ScheduleType } from '../models/scheduler.model'

export interface CreateScheduledTaskDTO {
  title: string
  description?: string | null
  /** Domyślnie true. */
  enabled?: boolean
  actionType: string
  actionConfig?: Record<string, unknown>
  scheduleType: ScheduleType
  scheduleConfig?: ScheduleConfig
  /** Wymagane dla `once`; dla `cron`/`interval` domyślnie teraz. */
  startAt?: string
  endAt?: string | null
  /** Strefa IANA, np. "Europe/Warsaw". Domyślnie "UTC". */
  timezone?: string
}

export type UpdateScheduledTaskDTO = Partial<CreateScheduledTaskDTO>

export interface ApiErrorDetail {
  path: string
  message: string
}

export interface ApiError {
  error: string
  details?: ApiErrorDetail[]
}
