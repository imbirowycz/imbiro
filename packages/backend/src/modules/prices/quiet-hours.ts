// Quiet hours of the home collector: a daily window in which it fetches nothing and does not
// even ask for work. The server enforces it by answering "no jobs, come back when it ends".

export interface QuietHours {
  /** Full hours 0–23 in `timeZone`; the window may cross midnight. Equal values = no quiet hours. */
  fromHour: number
  toHour: number
  timeZone: string
}

/** Seconds until the quiet window ends; 0 when `now` is outside it. */
export function quietSecondsLeft(now: Date, { fromHour, toHour, timeZone }: QuietHours): number {
  if (fromHour === toHour) return 0
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const hour = part('hour')
  const inside = fromHour < toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour
  if (!inside) return 0
  const hoursLeft = (toHour - hour + 24) % 24
  return hoursLeft * 3600 - part('minute') * 60 - part('second')
}
