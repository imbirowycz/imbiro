import { pool, type Queryable } from '../../db'

// News marked as read: hidden on the dashboard and skipped in the morning digest.
// Keyed by the canonical article URL — the same value radar modules put in NewsItem.url.

/** News are at most a few days old, so older marks can be forgotten. */
export const READ_ITEMS_RETENTION_DAYS = 14

export interface ReadItemsStore {
  /** URLs marked as read within the retention window. */
  listUrls(): Promise<string[]>
  markRead(item: { url: string; title?: string | null; source?: string | null }): Promise<void>
  unmarkRead(url: string): Promise<void>
}

export function createReadItemsRepository(db: Queryable = pool): ReadItemsStore {
  return {
    async listUrls() {
      const { rows } = await db.query<{ url: string }>(
        `SELECT url FROM radar_read_items WHERE read_at > NOW() - make_interval(days => $1) ORDER BY read_at DESC`,
        [READ_ITEMS_RETENTION_DAYS]
      )
      return rows.map((row) => row.url)
    },

    async markRead({ url, title = null, source = null }) {
      await db.query(
        `INSERT INTO radar_read_items (url, title, source) VALUES ($1, $2, $3)
         ON CONFLICT (url) DO UPDATE SET read_at = NOW()`,
        [url, title, source]
      )
      // Cheap housekeeping on write instead of a separate cron job.
      await db.query(`DELETE FROM radar_read_items WHERE read_at < NOW() - make_interval(days => $1)`, [READ_ITEMS_RETENTION_DAYS])
    },

    async unmarkRead(url) {
      await db.query(`DELETE FROM radar_read_items WHERE url = $1`, [url])
    },
  }
}
