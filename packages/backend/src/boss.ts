import type { PoolClient } from 'pg'
import { PgBoss, type Db, type Queue } from 'pg-boss'
import { config } from './config'

export const QUEUES = {
  // Jeden job = jeden termin wykonania zadania schedulera.
  execute: 'scheduler.execute',
  // Cykliczna (co minutę) ponowna synchronizacja terminów z kolejką — siatka bezpieczeństwa.
  reconcile: 'scheduler.reconcile',
} as const

// API tylko wysyła joby; utrzymanie kolejki (supervise, cron) robi wyłącznie Worker.
export type BossRole = 'api' | 'worker'

export function createBoss(role: BossRole): PgBoss {
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.boss.schema,
    application_name: `imbiro-${role}`,
    max: role === 'worker' ? config.worker.concurrency + 3 : 3,
    supervise: role === 'worker',
    schedule: role === 'worker',
  })

  boss.on('error', (err) => console.error(`[pg-boss:${role}] error`, err))
  boss.on('warning', (warning) => console.warn(`[pg-boss:${role}] warning: ${warning.message}`, warning.data))

  return boss
}

const queueDefinitions: Queue[] = [
  {
    name: QUEUES.execute,
    // Najwyżej jeden job w stanie created/retry/active na singletonKey (= jeden termin zadania).
    policy: 'exclusive',
    expireInSeconds: config.jobs.timeoutSeconds,
    retryLimit: config.jobs.retryLimit,
    retryDelay: config.jobs.retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: config.jobs.retryDelayMaxSeconds,
  },
  {
    name: QUEUES.reconcile,
    // Nie kumuluj przebiegów, gdy poprzedni jeszcze trwa.
    policy: 'exclusive',
    expireInSeconds: 120,
    retryLimit: 0,
    deleteAfterSeconds: 3600,
  },
]

// createQueue nie nadpisuje istniejącej kolejki, więc zmiany z env aplikujemy przez updateQueue.
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const { name, policy, partition, ...options } of queueDefinitions) {
    const existing = await boss.getQueue(name)
    if (!existing) {
      await boss.createQueue(name, { policy, partition, ...options })
    } else {
      await boss.updateQueue(name, options)
    }
  }
}

/** Pozwala wykonać operację pg-boss w transakcji otwartej na kliencie `pg`. */
export function bossDb(client: PoolClient): Db {
  return { executeSql: (text, values) => client.query(text, values) }
}
