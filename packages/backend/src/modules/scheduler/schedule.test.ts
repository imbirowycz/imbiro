import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  initialRunAt,
  isValidTimeZone,
  nextOccurrence,
  runAfter,
  validateCronExpression,
  type ScheduleDefinition,
} from './schedule'

const d = (iso: string) => new Date(iso)
const iso = (date: Date | null) => date?.toISOString() ?? null

function cron(expression: string, extra: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
  return {
    scheduleType: 'cron',
    scheduleConfig: { expression },
    startAt: d('2026-01-01T00:00:00Z'),
    endAt: null,
    timezone: 'UTC',
    ...extra,
  } as ScheduleDefinition
}

function interval(everySeconds: number, extra: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
  return {
    scheduleType: 'interval',
    scheduleConfig: { everySeconds },
    startAt: d('2026-10-25T10:00:00Z'),
    endAt: null,
    timezone: 'UTC',
    ...extra,
  } as ScheduleDefinition
}

function once(startAt: string): ScheduleDefinition {
  return { scheduleType: 'once', scheduleConfig: {}, startAt: d(startAt), endAt: null, timezone: 'UTC' }
}

describe('once', () => {
  it('runs at startAt when it is in the future', () => {
    assert.equal(iso(nextOccurrence(once('2026-10-25T12:00:00Z'), d('2026-10-25T10:00:00Z'))), '2026-10-25T12:00:00.000Z')
  })

  it('has no occurrence after startAt', () => {
    assert.equal(nextOccurrence(once('2026-10-25T12:00:00Z'), d('2026-10-25T12:00:00Z')), null)
  })

  it('initialRunAt tolerates a slightly past startAt but not an old one', () => {
    const now = d('2026-10-25T12:00:30Z')
    assert.equal(iso(initialRunAt(once('2026-10-25T12:00:00Z'), now)), '2026-10-25T12:00:00.000Z')
    assert.equal(initialRunAt(once('2026-10-25T11:00:00Z'), now), null)
  })
})

describe('interval', () => {
  it('starts at startAt', () => {
    assert.equal(iso(nextOccurrence(interval(1800), d('2026-10-25T09:00:00Z'))), '2026-10-25T10:00:00.000Z')
  })

  it('aligns to startAt + n × every', () => {
    assert.equal(iso(nextOccurrence(interval(1800), d('2026-10-25T10:45:00Z'))), '2026-10-25T11:00:00.000Z')
    assert.equal(iso(nextOccurrence(interval(1800), d('2026-10-25T11:00:00Z'))), '2026-10-25T11:30:00.000Z')
  })

  it('respects endAt inclusively', () => {
    const def = interval(1800, { endAt: d('2026-10-25T11:00:00Z') })
    assert.equal(iso(nextOccurrence(def, d('2026-10-25T10:30:00Z'))), '2026-10-25T11:00:00.000Z')
    assert.equal(nextOccurrence(def, d('2026-10-25T11:00:00Z')), null)
  })

  it('initialRunAt includes an occurrence exactly at now', () => {
    assert.equal(iso(initialRunAt(interval(1800), d('2026-10-25T10:30:00Z'))), '2026-10-25T10:30:00.000Z')
  })
})

describe('cron', () => {
  it('evaluates in the task timezone', () => {
    // 9:00 w Warszawie: przed zmianą czasu UTC+2, po 25.10.2026 UTC+1
    const def = cron('0 9 * * *', { timezone: 'Europe/Warsaw' })
    assert.equal(iso(nextOccurrence(def, d('2026-10-24T12:00:00Z'))), '2026-10-25T08:00:00.000Z')
    assert.equal(iso(nextOccurrence(def, d('2026-10-23T12:00:00Z'))), '2026-10-24T07:00:00.000Z')
  })

  it('does not run before startAt and allows an occurrence equal to startAt', () => {
    const def = cron('0 * * * *', { startAt: d('2026-10-25T10:00:00Z') })
    assert.equal(iso(nextOccurrence(def, d('2026-10-20T00:00:00Z'))), '2026-10-25T10:00:00.000Z')
  })

  it('respects endAt', () => {
    const def = cron('0 0 * * *', { endAt: d('2026-10-25T12:00:00Z') })
    assert.equal(nextOccurrence(def, d('2026-10-25T00:00:00Z')), null)
  })
})

describe('runAfter', () => {
  it('skips missed occurrences after downtime', () => {
    const def = interval(1800)
    const slot = d('2026-10-25T10:00:00Z')
    assert.equal(iso(runAfter(def, slot, d('2026-10-25T13:10:00Z'))), '2026-10-25T13:30:00.000Z')
  })

  it('returns the next slot when on time', () => {
    const def = interval(1800)
    assert.equal(iso(runAfter(def, d('2026-10-25T10:00:00Z'), d('2026-10-25T10:00:01Z'))), '2026-10-25T10:30:00.000Z')
  })
})

describe('validation helpers', () => {
  it('validates cron expressions', () => {
    assert.equal(validateCronExpression('*/30 * * * *', 'UTC'), null)
    assert.match(validateCronExpression('0 */30 * * * *', 'UTC') ?? '', /5 fields/)
    assert.match(validateCronExpression('61 * * * *', 'UTC') ?? '', /Invalid cron/)
  })

  it('validates time zones', () => {
    assert.equal(isValidTimeZone('Europe/Warsaw'), true)
    assert.equal(isValidTimeZone('UTC'), true)
    assert.equal(isValidTimeZone('Mars/Olympus'), false)
  })
})
