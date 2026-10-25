export type ScheduleType = 'once' | 'cron' | 'interval'

// once: termin = startAt
export type OnceScheduleConfig = Record<string, never>
// cron: 5 pól (minuta godzina dzień-miesiąca miesiąc dzień-tygodnia), liczone w strefie `timezone`
export interface CronScheduleConfig {
  expression: string
}
// interval: startAt + n × everySeconds
export interface IntervalScheduleConfig {
  everySeconds: number
}
export type ScheduleConfig = OnceScheduleConfig | CronScheduleConfig | IntervalScheduleConfig

export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed'
export type ExecutionTrigger = 'schedule' | 'manual'

/** Daty jako ISO 8601 (UTC). */
export interface ScheduledTask {
  id: string
  title: string
  description: string | null
  enabled: boolean
  actionType: string
  actionConfig: Record<string, unknown>
  scheduleType: ScheduleType
  scheduleConfig: ScheduleConfig
  startAt: string
  endAt: string | null
  timezone: string
  /** Najbliższy zaplanowany termin; null = brak kolejnych terminów albo zadanie wyłączone. */
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskExecution {
  id: string
  taskId: string
  trigger: ExecutionTrigger
  status: ExecutionStatus
  scheduledFor: string
  startedAt: string | null
  finishedAt: string | null
  attempts: number
  error: string | null
  result: unknown
  createdAt: string
  updatedAt: string
}
