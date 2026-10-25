// Jedno miejsce odczytu zmiennych środowiskowych dla procesu API i Workera.

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function int(name: string, defaultValue: number, min = 0): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Environment variable ${name} must be an integer >= ${min}, got "${raw}"`)
  }
  return value
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: int('PORT', 3000, 1),

  boss: {
    schema: process.env.PGBOSS_SCHEMA || 'pgboss',
  },

  worker: {
    // Liczba równoległych wykonań w jednym procesie Workera.
    concurrency: int('WORKER_CONCURRENCY', 2, 1),
    // Ile czekać na dokończenie aktywnych jobów przy zamykaniu.
    shutdownTimeoutSeconds: int('WORKER_SHUTDOWN_TIMEOUT_SECONDS', 30, 1),
  },

  jobs: {
    timeoutSeconds: int('JOB_TIMEOUT_SECONDS', 300, 1),
    retryLimit: int('JOB_RETRY_LIMIT', 3, 0),
    retryDelaySeconds: int('JOB_RETRY_DELAY_SECONDS', 30, 1),
    retryDelayMaxSeconds: int('JOB_RETRY_DELAY_MAX_SECONDS', 600, 1),
  },
}
