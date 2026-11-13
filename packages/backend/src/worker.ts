import type { JobWithMetadata } from 'pg-boss'
import { createBoss, ensureQueues, QUEUES } from './core/boss'
import { composeWorker } from './composition'
import { config } from './core/config'
import { pool } from './core/db'
import { runMigrations } from './core/migrate'
import { runProcess } from './core/process'
import type { ExecuteJobData } from './modules/scheduler'

// A process separate from Express: executes pg-boss jobs and maintains the queue.

const boss = createBoss('worker')
const { scheduler, executor } = composeWorker(boss)

async function reconcile(): Promise<void> {
  const enqueued = await scheduler.reconcile()
  if (enqueued > 0) console.log(`Reconcile: re-enqueued ${enqueued} scheduled run(s)`)
  await executor.recoverInterrupted()
}

async function start(): Promise<void> {
  await runMigrations()
  // Several attempts, because in Docker Compose the database may not accept connections yet.
  await boss.start({ attempts: 5 })
  await ensureQueues(boss)

  await reconcile()
  await boss.work(QUEUES.reconcile, reconcile)
  await boss.schedule(QUEUES.reconcile, '* * * * *')

  await boss.work(
    QUEUES.execute,
    { localConcurrency: config.worker.concurrency, batchSize: 1, includeMetadata: true },
    async ([job]: JobWithMetadata<ExecuteJobData>[]) => executor.process(job)
  )

  console.log(`Worker started (concurrency ${config.worker.concurrency})`)
}

async function stop(): Promise<void> {
  // graceful: stops fetching new jobs and waits for the active ones (up to the timeout).
  await boss.stop({ graceful: true, timeout: config.worker.shutdownTimeoutSeconds * 1000 })
  await pool.end()
}

runProcess({
  name: 'Worker',
  start,
  stop,
  forceExitAfterMs: (config.worker.shutdownTimeoutSeconds + 5) * 1000,
  exitOnUnhandledRejection: true,
})
