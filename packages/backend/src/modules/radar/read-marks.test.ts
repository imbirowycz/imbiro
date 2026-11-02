import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { alertMarkExpiry, newsMarkExpiry } from './read-marks'

const now = new Date('2026-11-02T12:00:00Z')
const day = 86_400_000

describe('read mark expiry', () => {
  it('news: 14 days', () => {
    assert.equal(newsMarkExpiry(now).getTime(), now.getTime() + 14 * day)
  })

  it('alert: end of the alert + 1 day', () => {
    assert.equal(alertMarkExpiry('2026-11-05T12:00:00Z', now).toISOString(), '2026-11-06T12:00:00.000Z')
  })

  it('alert without (or with an invalid) end: 60 days', () => {
    assert.equal(alertMarkExpiry(null, now).getTime(), now.getTime() + 60 * day)
    assert.equal(alertMarkExpiry('nonsense', now).getTime(), now.getTime() + 60 * day)
  })

  it('alert end in the past or far away is clamped', () => {
    assert.equal(alertMarkExpiry('2020-01-01T00:00:00Z', now).getTime(), now.getTime() + day)
    assert.equal(alertMarkExpiry('2099-01-01T00:00:00Z', now).getTime(), now.getTime() + 400 * day)
  })
})
