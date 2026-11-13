import fs from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db'

// The *.sql files live outside src/, so the same path works with tsx (src/) and with the build (dist/).
const migrationsDir = path.join(__dirname, '..', '..', 'migrations')

// Fixed lock key — the backend and the worker may start at the same time.
const MIGRATION_LOCK_KEY = 7_340_001

export async function runMigrations(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const appliedNames = new Set(applied.rows.map((row) => row.name))

    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      if (appliedNames.has(file)) continue

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Migration applied: ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {})
    client.release()
  }
}
