import pg from 'pg'
import { config } from './config'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.databaseUrl,
})

/** A pool or a client inside a transaction — repositories accept both. */
export type Queryable = pg.Pool | pg.PoolClient

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
