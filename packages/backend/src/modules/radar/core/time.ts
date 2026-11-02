// Polish public APIs (IMGW, GIOŚ) return local wall-clock time without an offset,
// e.g. "2026-11-02 21:00:00". This converts it to a real instant (ISO, UTC), DST included.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** Offset of `timeZone` from UTC at a given instant, in minutes (e.g. +60 for CET). */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(instant)
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** "YYYY-MM-DD HH:mm[:ss]" in `timeZone` → ISO string; null for missing/invalid input. */
export function localToIso(value: string | null | undefined, timeZone: string): string | null {
  const match = value ? LOCAL_RE.exec(value.trim()) : null
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match.map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0)
  // Two passes handle the DST switch: the offset depends on the instant we are computing.
  let instant = asUtc - offsetMinutes(asUtc, timeZone) * 60_000
  instant = asUtc - offsetMinutes(instant, timeZone) * 60_000
  return Number.isNaN(instant) ? null : new Date(instant).toISOString()
}

/** Open-Meteo style: local time plus a known UTC offset in seconds. */
export function localWithOffsetToIso(value: string, utcOffsetSeconds: number): string | null {
  const match = LOCAL_RE.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match.map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s || 0) - utcOffsetSeconds * 1000).toISOString()
}
