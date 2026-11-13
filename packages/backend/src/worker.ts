import type { JobWithMetadata } from 'pg-boss'
import { createBoss, ensureQueues, QUEUES } from './boss'
import { config } from './config'
import { pool } from './db'
import { runMigrations } from './migrate'
import { runProcess } from './process'
import type { ExecuteJobData } from './modules/scheduler/task.queue'
import { SchedulerExecutor } from './modules/scheduler/scheduler.executor'
import { SchedulerService } from './modules/scheduler/scheduler.service'

// Osobny proces od Express: wykonuje joby z pg-boss i odpowiada za utrzymanie kolejki.

const boss = createBoss('worker')
const scheduler = new SchedulerService(boss)
const executor = new SchedulerExecutor(boss)

async function reconcile(): Promise<void> {
  const enqueued = await scheduler.reconcile()
  if (enqueued > 0) console.log(`Reconcile: re-enqueued ${enqueued} scheduled run(s)`)
  await executor.recoverInterrupted()
}

async function start(): Promise<void> {
  await runMigrations()
  // Kilka prób, bo w Docker Compose baza może jeszcze nie przyjmować połączeń.
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
  // graceful: przestaje pobierać nowe joby i czeka na aktywne (do timeout).
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
