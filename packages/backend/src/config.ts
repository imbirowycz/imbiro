import fs from 'node:fs'
import path from 'node:path'

// Jedno miejsce odczytu zmiennych środowiskowych dla procesu API i Workera.

// Lokalnie (poza produkcją) zmienne mogą leżeć w packages/backend/.env — plik jest w .gitignore.
// Zmienne ustawione w środowisku mają pierwszeństwo przed plikiem.
const localEnvFile = path.join(__dirname, '..', '.env')
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
    // Liczba zaufanych reverse proxy przed API (Caddy = 1). Od tego zależy req.ip (limity logowania)
    // i req.protocol. 0 = połączenie bezpośrednie; nagłówki X-Forwarded-* są wtedy ignorowane.
    trustProxy: int('TRUST_PROXY', 0, 0),
    // Originy frontendu inne niż adres samego API, którym wolno wołać API z przeglądarki (CORS)
    // i wysyłać operacje zmieniające stan. Na produkcji frontend i API są pod jednym adresem — pusto.
    allowedOrigins: list('CORS_ORIGINS', isProduction ? [] : ['http://localhost:5173']),
  },

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

  // Jedyne konto administratora. Hasło wyłącznie jako hash Argon2id (npm run admin:hash).
  // Odczytywane leniwie: Worker nie potrzebuje danych logowania.
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
    // Bezwzględny czas życia sesji od zalogowania.
    ttlHours: int('SESSION_TTL_HOURS', 12, 1),
    // Wygaśnięcie po braku aktywności.
    idleMinutes: int('SESSION_IDLE_MINUTES', 120, 1),
    // Secure wymaga HTTPS; domyślnie włączone w produkcji.
    cookieSecure: bool('SESSION_COOKIE_SECURE', isProduction),
  },

  loginLimits: {
    windowMinutes: int('LOGIN_WINDOW_MINUTES', 15, 1),
    // Nieudane próby w oknie: z jednego IP dla jednego loginu / z jednego IP / dla jednego loginu ze wszystkich IP.
    maxPerIpAndLogin: int('LOGIN_MAX_FAILURES_PER_IP_LOGIN', 5, 1),
    maxPerIp: int('LOGIN_MAX_FAILURES_PER_IP', 20, 1),
    maxPerLogin: int('LOGIN_MAX_FAILURES_PER_LOGIN', 50, 1),
  },

  // Integracje akcji są opcjonalne: brak konfiguracji = czytelny błąd przy wykonaniu akcji.
  integrations: {
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: int('SMTP_PORT', 587, 1),
          // true = TLS od początku połączenia (zwykle port 465); false = STARTTLS.
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
