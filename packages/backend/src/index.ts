import type { Server } from 'node:http'
import { createApp } from './app'
import { createBoss, ensureQueues } from './boss'
import { config } from './config'
import { pool } from './db'
import { runMigrations } from './migrate'
import { runProcess } from './process'
import { prepareAuth } from './modules/auth/password'
import { SchedulerService } from './modules/scheduler/scheduler.service'

// API tylko zapisuje zadania i wysyła joby do pg-boss; wykonuje je osobny proces Workera.
const boss = createBoss('api')
let server: Server | undefined

async function start(): Promise<void> {
  // Brak/zła konfiguracja administratora zatrzymuje start, zamiast ujawnić się przy pierwszym logowaniu.
  await prepareAuth()
  await runMigrations()
  await boss.start({ attempts: 5 })
  // Idempotentne; API może wystartować przed Workerem i od razu przyjmować zadania.
  await ensureQueues(boss)

  const app = createApp(new SchedulerService(boss))
  server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Backend listening on http://0.0.0.0:${config.port}`)
  })
}

async function stop(): Promise<void> {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await boss.stop({ graceful: true, timeout: 5_000 })
  await pool.end()
}

runProcess({ name: 'Backend', start, stop, forceExitAfterMs: 15_000 })
