import type { Server } from 'node:http'
import { createApp } from './app'
import { createBoss, ensureQueues } from './core/boss'
import { composeApi } from './composition'
import { config } from './core/config'
import { pool } from './core/db'
import { runMigrations } from './core/migrate'
import { runProcess } from './core/process'
import { prepareAuth } from './modules/auth'

// The API only stores tasks and sends jobs to pg-boss; a separate Worker process executes them.
const boss = createBoss('api')
let server: Server | undefined

async function start(): Promise<void> {
  // A missing/bad administrator configuration stops startup instead of surfacing on the first login.
  await prepareAuth()
  await runMigrations()
  await boss.start({ attempts: 5 })
  // Idempotent; the API may start before the Worker and accept tasks right away.
  await ensureQueues(boss)

  const app = createApp(composeApi(boss))
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
