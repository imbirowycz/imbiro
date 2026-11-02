import { pool, type Queryable } from '../../db'

export { alertMarkExpiry, newsMarkExpiry } from './read-marks'

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

export interface ReadItemsStore {
  /** Keys of marks that are still valid. */
  listKeys(): Promise<string[]>
  markRead(mark: ReadMark): Promise<void>
  unmarkRead(key: string): Promise<void>
  /** Removes marks past their expiry; returns how many. */
  deleteExpired(): Promise<number>
}

export function createReadItemsRepository(db: Queryable = pool): ReadItemsStore {
  const deleteExpired = async () => (await db.query(`DELETE FROM radar_read_items WHERE expires_at < NOW()`)).rowCount ?? 0
  return {
    deleteExpired,

    async listKeys() {
      const { rows } = await db.query<{ item_key: string }>(
        `SELECT item_key FROM radar_read_items WHERE expires_at > NOW() ORDER BY read_at DESC`
      )
      return rows.map((row) => row.item_key)
    },

    async markRead({ key, title = null, source = null, expiresAt }) {
      await db.query(
        `INSERT INTO radar_read_items (item_key, title, source, expires_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_key) DO UPDATE SET read_at = NOW(), expires_at = EXCLUDED.expires_at`,
        [key, title, source, expiresAt]
      )
      // Cheap housekeeping on write; the db.cleanup scheduler action does the same on a schedule.
      await deleteExpired()
    },

    async unmarkRead(key) {
      await db.query(`DELETE FROM radar_read_items WHERE item_key = $1`, [key])
    },
  }
}
