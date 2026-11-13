import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import type { AdminUser } from '@myorg/shared'
import { config } from '../../core/config'

// Argon2id parameters: library defaults (m=64 MiB, t=3, p=4) — in line with OWASP recommendations.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

// Hash of a random password — verified when the login does not match, so the response time
// does not reveal whether the given login exists.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHash
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().slice(0, 200)
}

/** Returns the administrator when the login (or e-mail) and the password match; otherwise null. */
export async function verifyAdminCredentials(login: string, password: string): Promise<AdminUser | null> {
  const admin = config.admin
  const normalized = normalizeLogin(login)
  const loginMatches =
    normalized === admin.username.toLowerCase() || (admin.email !== null && normalized === admin.email.toLowerCase())

  const hash = loginMatches ? admin.passwordHash : await getDummyHash()
  let passwordMatches = false
  try {
    passwordMatches = await argon2.verify(hash, password)
  } catch {
    // A corrupted hash in the configuration is treated like wrong credentials — no details leak out.
    passwordMatches = false
  }

  return loginMatches && passwordMatches ? { username: admin.username, email: admin.email } : null
}

/** Called at API startup: an early configuration error and a ready dummy hash before the first login. */
export async function prepareAuth(): Promise<void> {
  void config.admin
  await getDummyHash()
}
