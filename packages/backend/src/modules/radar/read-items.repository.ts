import { pool, type Queryable } from '../../db'

// News and alerts marked as read: hidden on the dashboard and skipped in the morning digest.
// Keyed by `newsReadKey` / `alertReadKey` from @myorg/shared. Every mark has its own expiry,
// after which it is forgotten (news are gone from the feeds by then, alerts have ended).
// How long a mark lives: read-marks.ts.

export interface ReadMark {
  key: string
  title?: string | null
  source?: string | null
  /** When the mark can be forgotten. */
  expiresAt: Date
}

export class ReadItemsRepository {
  /** Keys of marks that are still valid. */
  async listKeys(db: Queryable = pool): Promise<string[]> {
    const { rows } = await db.query<{ item_key: string }>(
      `SELECT item_key FROM radar_read_items WHERE expires_at > NOW() ORDER BY read_at DESC`
    )
    return rows.map((row) => row.item_key)
  }

  async markRead({ key, title = null, source = null, expiresAt }: ReadMark, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO radar_read_items (item_key, title, source, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_key) DO UPDATE SET read_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [key, title, source, expiresAt]
    )
    // Cheap housekeeping on write; the db.cleanup scheduler action does the same on a schedule.
    await this.deleteExpired(db)
  }

  /** Several marks in one statement (e.g. "mark the whole section as read"). */
  async markManyRead(marks: ReadMark[], db: Queryable = pool): Promise<void> {
    if (marks.length === 0) return
    // Last mark wins for a key that repeats (ON CONFLICT cannot touch the same row twice in one statement).
    const unique = [...new Map(marks.map((m) => [m.key, m])).values()]
    await db.query(
      `INSERT INTO radar_read_items (item_key, title, source, expires_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
       ON CONFLICT (item_key) DO UPDATE SET read_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [unique.map((m) => m.key), unique.map((m) => m.title ?? null), unique.map((m) => m.source ?? null), unique.map((m) => m.expiresAt)]
    )
    await this.deleteExpired(db)
  }

  async unmarkRead(key: string, db: Queryable = pool): Promise<void> {
    await db.query(`DELETE FROM radar_read_items WHERE item_key = $1`, [key])
  }

  async unmarkManyRead(keys: string[], db: Queryable = pool): Promise<void> {
    if (keys.length === 0) return
    await db.query(`DELETE FROM radar_read_items WHERE item_key = ANY($1::text[])`, [keys])
  }

  /** Removes marks past their expiry; returns how many. */
  async deleteExpired(db: Queryable = pool): Promise<number> {
    return (await db.query(`DELETE FROM radar_read_items WHERE expires_at < NOW()`)).rowCount ?? 0
  }
}
