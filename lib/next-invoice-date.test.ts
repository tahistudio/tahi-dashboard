import { describe, it, expect } from 'vitest'
import { cadenceWord, projectNextInvoiceDate } from './next-invoice-date'

describe('projectNextInvoiceDate', () => {
  it('returns null when there is no period start to project from', () => {
    expect(projectNextInvoiceDate(null, 'monthly')).toBeNull()
    expect(projectNextInvoiceDate(undefined, 'monthly')).toBeNull()
    expect(projectNextInvoiceDate('not a date', 'monthly')).toBeNull()
  })

  it('projects one cycle forward when the last period start is still current', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    // Started 5 days ago on a monthly cadence: next bill is a month out.
    const start = '2026-09-08T00:00:00.000Z'
    expect(projectNextInvoiceDate(start, 'monthly', now)).toBe('2026-10-08T00:00:00.000Z')
  })

  it('rolls forward past cycles a stale period start has already missed', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    // A period start recorded 4 months ago on a monthly cadence must not
    // project a date in the past: the client's next bill is still ahead.
    const start = '2026-05-01T00:00:00.000Z'
    const result = projectNextInvoiceDate(start, 'monthly', now)
    expect(result).not.toBeNull()
    expect(new Date(result as string).getTime()).toBeGreaterThanOrEqual(now.getTime())
    expect(result).toBe('2026-10-01T00:00:00.000Z')
  })

  it('honours a quarterly cadence', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    const start = '2026-07-01T00:00:00.000Z'
    expect(projectNextInvoiceDate(start, 'quarterly', now)).toBe('2026-10-01T00:00:00.000Z')
  })

  it('honours an annual cadence', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    const start = '2026-01-01T00:00:00.000Z'
    expect(projectNextInvoiceDate(start, 'annual', now)).toBe('2027-01-01T00:00:00.000Z')
  })

  it('falls back to monthly for an unrecognised interval rather than throwing', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    expect(projectNextInvoiceDate('2026-09-08T00:00:00.000Z', 'fortnightly', now))
      .toBe('2026-10-08T00:00:00.000Z')
    expect(projectNextInvoiceDate('2026-09-08T00:00:00.000Z', null, now))
      .toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('cadenceWord', () => {
  it('names each known cadence', () => {
    expect(cadenceWord('monthly')).toBe('monthly')
    expect(cadenceWord('quarterly')).toBe('quarterly')
    expect(cadenceWord('annual')).toBe('annually')
  })

  it('defaults to monthly for anything unrecognised', () => {
    expect(cadenceWord(null)).toBe('monthly')
    expect(cadenceWord(undefined)).toBe('monthly')
    expect(cadenceWord('weekly')).toBe('monthly')
  })
})
