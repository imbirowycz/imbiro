import fs from 'node:fs'
import path from 'node:path'

// The single place where environment variables are read, for both the API and the Worker process.

// Locally (outside production) variables may live in packages/backend/.env — the file is in .gitignore.
// Variables set in the environment take precedence over the file.
const localEnvFile = path.join(__dirname, '..', '..', '.env')
if (process.env.NODE_ENV !== 'production' && fs.existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile)
}

const isProduction = process.env.NODE_ENV === 'production'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function bool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`Environment variable ${name} must be "true" or "false", got "${raw}"`)
  }
  return raw === 'true'
}

function list(name: string, defaultValue: string[]): string[] {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)
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
  isProduction,
  databaseUrl: required('DATABASE_URL'),
  port: int('PORT', 3000, 1),

  http: {
    // Number of trusted reverse proxies in front of the API (Caddy = 1). It determines req.ip (login limits)
    // and req.protocol. 0 = direct connection; X-Forwarded-* headers are then ignored.
    trustProxy: int('TRUST_PROXY', 0, 0),
    // Frontend origins other than the API's own address that may call the API from a browser (CORS)
    // and send state-changing requests. In production the frontend and the API share one address — empty.
    allowedOrigins: list('CORS_ORIGINS', isProduction ? [] : ['http://localhost:5173']),
  },

  boss: {
    schema: process.env.PGBOSS_SCHEMA || 'pgboss',
  },

  worker: {
    // Number of parallel executions in one Worker process.
    concurrency: int('WORKER_CONCURRENCY', 2, 1),
    // How long to wait for active jobs to finish on shutdown.
    shutdownTimeoutSeconds: int('WORKER_SHUTDOWN_TIMEOUT_SECONDS', 30, 1),
  },

  jobs: {
    timeoutSeconds: int('JOB_TIMEOUT_SECONDS', 300, 1),
    retryLimit: int('JOB_RETRY_LIMIT', 3, 0),
    retryDelaySeconds: int('JOB_RETRY_DELAY_SECONDS', 30, 1),
    retryDelayMaxSeconds: int('JOB_RETRY_DELAY_MAX_SECONDS', 600, 1),
  },

  // The only administrator account. The password only as an Argon2id hash (npm run admin:hash).
  // Read lazily: the Worker does not need login data.
  get admin() {
    const passwordHash = required('ADMIN_PASSWORD_HASH')
    if (!passwordHash.startsWith('$argon2id$')) {
      throw new Error('ADMIN_PASSWORD_HASH must be an Argon2id hash (generate it with: npm run admin:hash)')
    }
    return {
      username: required('ADMIN_USERNAME').trim(),
      email: process.env.ADMIN_EMAIL?.trim() || null,
      passwordHash,
    }
  },

  session: {
    // Absolute session lifetime since login (30 days by default).
    ttlHours: int('SESSION_TTL_HOURS', 720, 1),
    // Expiry after inactivity (7 days by default); every API request moves this deadline.
    idleMinutes: int('SESSION_IDLE_MINUTES', 10080, 1),
    // Secure requires HTTPS; on by default in production.
    cookieSecure: bool('SESSION_COOKIE_SECURE', isProduction),
  },

  loginLimits: {
    windowMinutes: int('LOGIN_WINDOW_MINUTES', 15, 1),
    // Failed attempts within the window: from one IP for one login / from one IP / for one login from all IPs.
    maxPerIpAndLogin: int('LOGIN_MAX_FAILURES_PER_IP_LOGIN', 5, 1),
    maxPerIp: int('LOGIN_MAX_FAILURES_PER_IP', 20, 1),
    maxPerLogin: int('LOGIN_MAX_FAILURES_PER_LOGIN', 50, 1),
  },

  // Okazje: the home collector fetches shop pages and takes these limits from the server.
  prices: {
    // Shared secret of the collector (Authorization: Bearer). Unset = the collector API rejects everyone.
    collectorToken: process.env.COLLECTOR_TOKEN || undefined,
    pollSeconds: int('COLLECTOR_POLL_SECONDS', 60, 5),
    domainGapSeconds: int('COLLECTOR_DOMAIN_GAP_SECONDS', 30, 0),
    pageTimeoutSeconds: int('COLLECTOR_PAGE_TIMEOUT_SECONDS', 45, 5),
    maxJobsPerClaim: int('COLLECTOR_MAX_JOBS_PER_CLAIM', 3, 1),
    // The collector counts as online when it asked for work within this time.
    onlineWithinSeconds: int('COLLECTOR_ONLINE_WITHIN_SECONDS', 180, 10),
    // Quiet hours (Europe/Warsaw, full hours): the collector fetches nothing and does not call the
    // API at all; checks planned for that time wait in the queue. Equal values switch them off.
    quietFromHour: int('COLLECTOR_QUIET_FROM_HOUR', 22, 0),
    quietToHour: int('COLLECTOR_QUIET_TO_HOUR', 5, 0),
  },

  // Action integrations are optional: missing configuration = a clear error when the action runs.
  integrations: {
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: int('SMTP_PORT', 587, 1),
          // true = TLS from the start of the connection (usually port 465); false = STARTTLS.
          secure: process.env.SMTP_SECURE === 'true',
          user: process.env.SMTP_USER || undefined,
          password: process.env.SMTP_PASSWORD || undefined,
          from: process.env.SMTP_FROM || undefined,
        }
      : null,
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    },
  },
}
