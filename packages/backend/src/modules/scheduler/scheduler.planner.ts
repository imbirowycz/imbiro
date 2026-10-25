import type { PgBoss, Db } from 'pg-boss'
import { QUEUES } from '../../boss'
import type { TaskRecord } from './scheduler.repository'

// Integracja harmonogramu z pg-boss: jeden zaplanowany termin zadania = jeden job w kolejce.

export interface ExecuteJobData {
  taskId: string
  /** ISO termin, którego dotyczy job. */
  scheduledFor: string
  /** Wersja harmonogramu z chwili planowania; job ze starszą wersją jest pomijany. */
  scheduleVersion: number
  trigger: 'schedule'
}

/**
 * Klucz terminu. Kolejka ma politykę `exclusive`, więc pg-boss nie przyjmie drugiego joba
 * z tym samym kluczem, dopóki pierwszy czeka lub jest wykonywany — to chroni przed podwójnym
 * zaplanowaniem (np. równoległa edycja i reconcile).
 */
export function slotKey(task: TaskRecord): string | null {
  if (!task.enabled || !task.nextRunAt) return null
  return `${task.id}:${task.scheduleVersion}:${task.nextRunAt.toISOString()}`
}

/** Dodaje job dla bieżącego terminu zadania. Zwraca id joba albo null (brak terminu / już w kolejce). */
export async function enqueueSlot(boss: PgBoss, task: TaskRecord, db?: Db): Promise<string | null> {
  const key = slotKey(task)
  if (!key || !task.nextRunAt) return null

  const data: ExecuteJobData = {
    taskId: task.id,
    scheduledFor: task.nextRunAt.toISOString(),
    scheduleVersion: task.scheduleVersion,
    trigger: 'schedule',
  }
  return boss.send(QUEUES.execute, data, { singletonKey: key, startAfter: task.nextRunAt, db })
}

/** Anuluje oczekujący job poprzedniego terminu. Brak joba nie jest błędem. */
export async function cancelSlot(boss: PgBoss, task: TaskRecord, db?: Db): Promise<void> {
  const key = slotKey(task)
  if (!key) return

  const jobs = await boss.findJobs(QUEUES.execute, { key, queued: true, db })
  if (jobs.length > 0) {
    await boss.cancel(QUEUES.execute, jobs.map((job) => job.id), { db })
  }
}

/**
 * Doprowadza kolejkę do stanu zgodnego z zadaniem po zmianie. Anulowanie starego joba jest
 * porządkowe — nawet jeśli by się nie udało, worker pominie go po `scheduleVersion`.
 */
export async function syncSlot(
  boss: PgBoss,
  previous: TaskRecord | null,
  current: TaskRecord,
  db?: Db
): Promise<void> {
  const previousKey = previous ? slotKey(previous) : null
  const currentKey = slotKey(current)
  if (previousKey === currentKey) return

  if (previous) await cancelSlot(boss, previous, db)
  await enqueueSlot(boss, current, db)
}
