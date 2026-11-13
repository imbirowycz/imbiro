import { createHash, randomBytes } from 'node:crypto'
import { config } from '../../config'
import { pool, type Queryable } from '../../db'

export interface AuthSession {
  /** SHA-256 of the token — the key in the database. */
  id: string
  csrfToken: string
  createdAt: Date
  expiresAt: Date
}

interface SessionRow {
  id: string
  csrf_token: string
  created_at: Date
  last_seen_at: Date
  expires_at: Date
}

// Activity is recorded at most once a minute, to avoid an UPDATE on every request.
const TOUCH_INTERVAL_MS = 60_000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toSession(row: SessionRow): AuthSession {
  return { id: row.id, csrfToken: row.csrf_token, createdAt: row.created_at, expiresAt: row.expires_at }
}

export class SessionRepository {
  /** New session. Returns the token for the cookie — only its hash stays in the database. */
  async create(meta: { ip: string; userAgent: string | null }, db: Queryable = pool): Promise<{ token: string; session: AuthSession }> {
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const result = await db.query<SessionRow>(
      `INSERT INTO admin_sessions (id, csrf_token, expires_at, ip, user_agent)
       VALUES ($1, $2, NOW() + make_interval(hours => $3), $4, $5)
       RETURNING *`,
      [hashToken(token), csrfToken, config.session.ttlHours, meta.ip, meta.userAgent?.slice(0, 500) ?? null]
    )
    return { token, session: toSession(result.rows[0]) }
  }

  /** Active session for the cookie token (expired neither absolutely nor through inactivity). */
  async findActive(token: string, db: Queryable = pool): Promise<AuthSession | null> {
    const result = await db.query<SessionRow>(
      `SELECT * FROM admin_sessions
        WHERE id = $1 AND expires_at > NOW() AND last_seen_at > NOW() - make_interval(mins => $2)`,
      [hashToken(token), config.session.idleMinutes]
    )
    const row = result.rows[0]
    if (!row) return null

    if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await db.query('UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = $1', [row.id])
    }
    return toSession(row)
  }

  async deleteByToken(token: string, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM admin_sessions WHERE id = $1', [hashToken(token)])
  }

  async deleteExpired(db: Queryable = pool): Promise<number> {
    const result = await db.query(
      `DELETE FROM admin_sessions
        WHERE expires_at <= NOW() OR last_seen_at <= NOW() - make_interval(mins => $1)`,
      [config.session.idleMinutes]
    )
    return result.rowCount ?? 0
  }
}
