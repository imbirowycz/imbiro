// Startup and graceful shutdown shared by the API and Worker processes.

export interface ProcessOptions {
  /** Used in log messages, e.g. "Backend", "Worker". */
  name: string
  start: () => Promise<void>
  /** Releases resources (server, queue, database pool); called once. */
  stop: () => Promise<void>
  /** Hard limit in case the graceful stop hangs. */
  forceExitAfterMs: number
  /** Shut down (exit code 1) on an unhandled promise rejection. */
  exitOnUnhandledRejection?: boolean
}

export function runProcess({ name, start, stop, forceExitAfterMs, exitOnUnhandledRejection = false }: ProcessOptions): void {
  let shuttingDown = false

  async function shutdown(signal: string, exitCode = 0): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`${name} received ${signal}, shutting down…`)

    const forceExit = setTimeout(() => {
      console.error(`${name} shutdown timed out, forcing exit`)
      process.exit(1)
    }, forceExitAfterMs)
    forceExit.unref()

    try {
      await stop()
      console.log(`${name} stopped`)
    } catch (err) {
      console.error(`Error during ${name.toLowerCase()} shutdown`, err)
      exitCode = 1
    }
    process.exit(exitCode)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  if (exitOnUnhandledRejection) {
    process.on('unhandledRejection', (reason) => {
      console.error(`Unhandled rejection in ${name.toLowerCase()}`, reason)
      void shutdown('unhandledRejection', 1)
    })
  }

  start().catch((err) => {
    console.error(`${name} failed to start`, err)
    void shutdown('startup failure', 1)
  })
}
