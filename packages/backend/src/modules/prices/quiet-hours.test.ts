import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { quietSecondsLeft } from './quiet-hours'

const night = { fromHour: 22, toHour: 5, timeZone: 'Europe/Warsaw' }
// Warsaw is UTC+1 in winter and UTC+2 in summer.
const left = (iso: string, hours = night) => quietSecondsLeft(new Date(iso), hours)

describe('quietSecondsLeft', () => {
  it('is 0 outside the window', () => {
    assert.equal(left('2026-11-14T20:59:59Z'), 0) // 21:59:59 in Warsaw
    assert.equal(left('2026-11-14T04:00:00Z'), 0) // 05:00:00
    assert.equal(left('2026-11-14T11:00:00Z'), 0)
  })

  it('counts down to the end of a window that crosses midnight', () => {
    assert.equal(left('2026-11-14T21:00:00Z'), 7 * 3600) // 22:00 → 05:00
    assert.equal(left('2026-11-14T23:30:00Z'), 4.5 * 3600) // 00:30
    assert.equal(left('2026-11-15T03:59:30Z'), 30) // 04:59:30
  })

  it('follows the time zone, not UTC (summer time)', () => {
    assert.equal(left('2026-07-01T20:00:00Z'), 7 * 3600) // 22:00 in Warsaw
    assert.equal(left('2026-07-01T19:59:59Z'), 0)
  })

  it('handles a window within one day and a disabled one', () => {
    assert.equal(left('2026-11-14T12:30:00Z', { fromHour: 13, toHour: 15, timeZone: 'Europe/Warsaw' }), 1.5 * 3600)
    assert.equal(left('2026-11-14T23:00:00Z', { fromHour: 0, toHour: 0, timeZone: 'Europe/Warsaw' }), 0)
  })
})
