import pg from 'pg'
import { config } from './config'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.databaseUrl,
})
