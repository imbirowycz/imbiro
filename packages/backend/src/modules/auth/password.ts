import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import type { AdminUser } from '@myorg/shared'
import { config } from '../../config'

// Parametry Argon2id: domyślne biblioteki (m=64 MiB, t=3, p=4) — zgodne z zaleceniami OWASP.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

// Hash losowego hasła — weryfikowany, gdy login nie pasuje, żeby czas odpowiedzi
// nie zdradzał, czy podany login istnieje.
let dummyHash: Promise<string> | undefined
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHash
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().slice(0, 200)
}

/** Zwraca administratora, gdy login (lub e-mail) i hasło się zgadzają; w innym razie null. */
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
    // Uszkodzony hash w konfiguracji traktujemy jak błędne dane — bez szczegółów na zewnątrz.
    passwordMatches = false
  }

  return loginMatches && passwordMatches ? { username: admin.username, email: admin.email } : null
}

/** Wywoływane przy starcie API: wczesny błąd konfiguracji i gotowy hash-atrapa przed pierwszym logowaniem. */
export async function prepareAuth(): Promise<void> {
  void config.admin
  await getDummyHash()
}
