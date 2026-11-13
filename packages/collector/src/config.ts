import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The only place where the collector reads its environment. Everything about *what* and
// *how often* to fetch comes from the server; here is only how to reach it and the browser.

const envFile = path.join(__dirname, '..', '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name} — set it in packages/collector/.env (see .env.example)`)
  return value
}

export const config = {
  apiUrl: required('API_URL').replace(/\/$/, ''),
  token: required('COLLECTOR_TOKEN'),
  hostname: os.hostname(),
  profileDir: path.resolve(process.env.PROFILE_DIR?.trim() || path.join(__dirname, '..', '.profile')),
  browserChannel: process.env.BROWSER_CHANNEL?.trim() || 'chrome',
  headless: process.env.HEADLESS === 'true',
}
