// Zamiana tekstu ceny ze stron sklepów na liczbę.
// Obsługuje zapis polski („1 299,99 zł”, „189,-”), z kropkami tysięcy („1.299,00”),
// angielski („1,299.00”) i wartości z atrybutów („189.99”).

const NUMBER_TOKEN = /\d[\d\s.,  ']*/

/** Zwraca cenę albo null, gdy w tekście nie ma liczby. */
export function parsePlPrice(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const text = String(raw).replace(/,-/g, '').replace(/\.-/g, '')
  const match = NUMBER_TOKEN.exec(text)
  if (!match) return null
  let token = match[0].replace(/[\s  ']/g, '').replace(/[.,]+$/, '')
  if (!token) return null

  const lastComma = token.lastIndexOf(',')
  const lastDot = token.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // Ostatni z separatorów jest dziesiętny, drugi to separator tysięcy.
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    token = token.split(thousands).join('').replace(decimal, '.')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.'
    const parts = token.split(sep)
    const tail = parts[parts.length - 1]
    // „1.299” / „1,299” / „1.299.000” → tysiące; „189,99” / „189.9” → część dziesiętna.
    if (parts.length > 2 || tail.length === 3) token = parts.join('')
    else token = parts.join('.')
  }

  const value = Number(token)
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

/** Liczba z atrybutu/tekstu w formacie maszynowym (np. content="1299.99"). */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const text = String(raw).trim().replace(',', '.')
  const value = Number(text)
  if (text !== '' && Number.isFinite(value)) return Math.round(value * 100) / 100
  return parsePlPrice(raw)
}

export function normalizeText(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const text = String(raw).replace(/\s+/g, ' ').trim()
  return text || null
}
