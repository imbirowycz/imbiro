// Generuje hash Argon2id hasła administratora do zmiennej ADMIN_PASSWORD_HASH.
// Hasło czyta ze standardowego wejścia (bez echa w terminalu), nigdy z argumentów —
// te trafiają do historii powłoki i listy procesów.
//
//   npm run admin:hash --workspace=@myorg/backend
//   docker compose -f docker-compose.prod.yml run --rm -it backend node packages/backend/dist/scripts/hash-password.js
// Bez importu config.ts — skrypt nie potrzebuje bazy ani pozostałych zmiennych.
import argon2 from 'argon2'

const MIN_LENGTH = 8
const RECOMMENDED_LENGTH = 12

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    // Wejście z potoku: pierwsza linia.
    return new Promise((resolve) => {
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => (data += chunk))
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''))
    })
  }

  process.stderr.write(prompt)
  return new Promise((resolve, reject) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          stdin.setRawMode(false)
          reject(new Error('Cancelled'))
          return
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  const password = await readHidden('Hasło administratora: ')
  if (password.length < MIN_LENGTH) {
    throw new Error(`Hasło musi mieć co najmniej ${MIN_LENGTH} znaków.`)
  }
  if (process.stdin.isTTY) {
    const repeated = await readHidden('Powtórz hasło: ')
    if (repeated !== password) throw new Error('Hasła się różnią.')
  }
  if (password.length < RECOMMENDED_LENGTH) {
    process.stderr.write(`Uwaga: hasło krótsze niż ${RECOMMENDED_LENGTH} znaków jest słabe — nie używaj go na produkcji.\n`)
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id })
  // Pojedyncze cudzysłowy: Docker Compose nie interpoluje wtedy znaków $ z hasha.
  process.stdout.write(`ADMIN_PASSWORD_HASH='${hash}'\n`)
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`)
  process.exit(1)
})
