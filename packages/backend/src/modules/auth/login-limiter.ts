import { config } from '../../config'
import { pool, type Queryable } from '../../db'

interface CountsRow {
  ip_login: number
  ip: number
  login: number
  ip_login_oldest: Date | null
  ip_oldest: Date | null
  login_oldest: Date | null
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * Limity nieudanych logowań w przesuwnym oknie czasu, trzymane w PostgreSQL (przetrwają restart).
 * Trzy wymiary: IP + login (typowe zgadywanie), samo IP (wiele loginów z jednego adresu)
 * i sam login (atak rozproszony z wielu adresów).
 */
export class LoginLimiter {
  async check(ip: string, identifier: string, db: Queryable = pool): Promise<LimitDecision> {
    const limits = config.loginLimits
    const result = await db.query<CountsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE ip = $1 AND identifier = $2)::int AS ip_login,
         COUNT(*) FILTER (WHERE ip = $1)::int AS ip,
         COUNT(*) FILTER (WHERE identifier = $2)::int AS login,
         MIN(created_at) FILTER (WHERE ip = $1 AND identifier = $2) AS ip_login_oldest,
         MIN(created_at) FILTER (WHERE ip = $1) AS ip_oldest,
         MIN(created_at) FILTER (WHERE identifier = $2) AS login_oldest
       FROM login_attempts
       WHERE NOT succeeded
         AND created_at > NOW() - make_interval(mins => $3)
         AND (ip = $1 OR identifier = $2)`,
      [ip, identifier, limits.windowMinutes]
    )
    const row = result.rows[0]
    const exceeded = [
      row.ip_login >= limits.maxPerIpAndLogin ? row.ip_login_oldest : null,
      row.ip >= limits.maxPerIp ? row.ip_oldest : null,
      row.login >= limits.maxPerLogin ? row.login_oldest : null,
    ].filter((oldest): oldest is Date => oldest !== null)

    if (exceeded.length === 0) return { allowed: true }

    // Blokada mija, gdy najstarsza nieudana próba wypadnie z okna.
    const unlockAt = Math.max(...exceeded.map((oldest) => oldest.getTime() + limits.windowMinutes * 60_000))
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000)) }
  }

  async record(ip: string, identifier: string, succeeded: boolean, db: Queryable = pool): Promise<void> {
    await db.query('INSERT INTO login_attempts (ip, identifier, succeeded) VALUES ($1, $2, $3)', [ip, identifier, succeeded])
  }

  async deleteOld(db: Queryable = pool): Promise<void> {
    await db.query(`DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '1 day'`)
  }
}
