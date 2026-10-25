import type { Server } from 'node:http'
import { createApp } from './app'
import { createBoss, ensureQueues } from './boss'
import { config } from './config'
import { pool } from './db'
import { runMigrations } from './migrate'
import { SchedulerService } from './modules/scheduler/scheduler.service'

// API tylko zapisuje zadania i wysyła joby do pg-boss; wykonuje je osobny proces Workera.
const boss = createBoss('api')
let server: Server | undefined
let shuttingDown = false

async function main(): Promise<void> {
  await runMigrations()
  await boss.start({ attempts: 5 })
  // Idempotentne; API może wystartować przed Workerem i od razu przyjmować zadania.
  await ensureQueues(boss)

  const app = createApp(new SchedulerService(boss))
  server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Backend listening on http://0.0.0.0:${config.port}`)
  })
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Backend received ${signal}, shutting down…`)

  const forceExit = setTimeout(() => process.exit(1), 15_000)
  forceExit.unref()

  try {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    await boss.stop({ graceful: true, timeout: 5_000 })
    await pool.end()
  } catch (err) {
    console.error('Error during backend shutdown', err)
    exitCode = 1
  }
  process.exit(exitCode)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

main().catch((err) => {
  console.error('Backend failed to start', err)
  void shutdown('startup failure', 1)
})
