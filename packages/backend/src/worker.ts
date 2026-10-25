import { createBoss, ensureQueues, QUEUES } from './boss'
import { config } from './config'
import { pool } from './db'
import { runMigrations } from './migrate'
import { SchedulerService } from './modules/scheduler/scheduler.service'

// Osobny proces od Express: wykonuje joby z pg-boss i odpowiada za utrzymanie kolejki.

const boss = createBoss('worker')
const scheduler = new SchedulerService(boss)
let shuttingDown = false

async function reconcile(): Promise<void> {
  const enqueued = await scheduler.reconcile()
  if (enqueued > 0) console.log(`Reconcile: re-enqueued ${enqueued} scheduled run(s)`)
}

async function main(): Promise<void> {
  await runMigrations()
  // Kilka prób, bo w Docker Compose baza może jeszcze nie przyjmować połączeń.
  await boss.start({ attempts: 5 })
  await ensureQueues(boss)

  await reconcile()
  await boss.work(QUEUES.reconcile, reconcile)
  await boss.schedule(QUEUES.reconcile, '* * * * *')

  console.log(`Worker started (concurrency ${config.worker.concurrency})`)
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Worker received ${signal}, shutting down…`)

  // Twardy limit, gdyby graceful stop się zawiesił.
  const forceExit = setTimeout(() => {
    console.error('Worker shutdown timed out, forcing exit')
    process.exit(1)
  }, (config.worker.shutdownTimeoutSeconds + 5) * 1000)
  forceExit.unref()

  try {
    // graceful: przestaje pobierać nowe joby i czeka na aktywne (do timeout).
    await boss.stop({ graceful: true, timeout: config.worker.shutdownTimeoutSeconds * 1000 })
    await pool.end()
    console.log('Worker stopped')
  } catch (err) {
    console.error('Error during worker shutdown', err)
    exitCode = 1
  }
  process.exit(exitCode)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in worker', reason)
  void shutdown('unhandledRejection', 1)
})

main().catch((err) => {
  console.error('Worker failed to start', err)
  void shutdown('startup failure', 1)
})
