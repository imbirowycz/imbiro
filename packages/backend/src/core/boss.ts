import type { PoolClient } from 'pg'
import { PgBoss, type Db, type Queue } from 'pg-boss'
import { config } from './config'

export const QUEUES = {
  // One job = one scheduled run of a scheduler task.
  execute: 'scheduler.execute',
  // Periodic (every minute) re-sync of planned runs with the queue — a safety net.
  reconcile: 'scheduler.reconcile',
  // Okazje: one check of one price source. Nobody works this queue — the home collector
  // claims jobs through the API (see modules/prices/collector.controller.ts).
  priceCheck: 'prices.check',
} as const

export const JOB_EXPIRE_GRACE_SECONDS = 60

// The API only sends jobs; queue maintenance (supervise, cron) is done by the Worker alone.
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
    // At most one job in created/retry/active state per singletonKey (= one run of a task).
    policy: 'exclusive',
    // The hard pg-boss limit is longer than the action timeout enforced by the executor — we record
    // the result ourselves, and job expiry remains for the case when the worker stopped working.
    expireInSeconds: config.jobs.timeoutSeconds + JOB_EXPIRE_GRACE_SECONDS,
    retryLimit: config.jobs.retryLimit,
    retryDelay: config.jobs.retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: config.jobs.retryDelayMaxSeconds,
  },
  {
    name: QUEUES.reconcile,
    // Do not pile up runs while the previous one is still in progress.
    policy: 'exclusive',
    expireInSeconds: 120,
    retryLimit: 0,
    deleteAfterSeconds: 3600,
  },
  {
    name: QUEUES.priceCheck,
    // singletonKey = source (+ kind of check): checks of one source do not pile up.
    policy: 'exclusive',
    // A claimed job the collector never reported back (laptop went off) expires and is retried.
    expireInSeconds: 300,
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 900,
    deleteAfterSeconds: 7 * 24 * 3600,
  },
]

// createQueue does not overwrite an existing queue, so changes from env are applied with updateQueue.
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

/** Lets a pg-boss operation run inside a transaction opened on a `pg` client. */
export function bossDb(client: PoolClient): Db {
  return { executeSql: (text, values) => client.query(text, values) }
}
