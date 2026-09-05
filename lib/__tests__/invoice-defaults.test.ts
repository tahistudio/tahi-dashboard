/**
 * Unit tests for lib/invoice-defaults.ts: the three values a new invoice opens
 * with once a client is picked. The due-date cases carry the weight, because
 * that is where a local Date would silently move money by a day.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INVOICE_CURRENCY,
  defaultCurrency,
  defaultDestination,
  defaultDueDate,
  localCalendarDay,
  resolveChannelDefaults,
} from '@/lib/invoice-defaults'

describe('defaultDestination', () => {
  it('opens on the rail the client resolves to', () => {
    expect(defaultDestination('xero')).toBe('xero')
    expect(defaultDestination('stripe')).toBe('stripe')
  })

  it('never opens on Dashboard only, which is an operator choice', () => {
    expect(defaultDestination('manual')).toBe('stripe')
  })

  it('falls back to the studio-wide default for anything unrecognised', () => {
    expect(defaultDestination(null)).toBe('stripe')
    expect(defaultDestination(undefined)).toBe('stripe')
    expect(defaultDestination('')).toBe('stripe')
    // The three-rail draft of this feature is not vocabulary any more.
    expect(defaultDestination('xero_bank')).toBe('stripe')
    expect(defaultDestination('xero_stripe')).toBe('stripe')
    expect(defaultDestination(7)).toBe('stripe')
  })
})

describe('defaultDueDate', () => {
  it('is today for a card client and for a client with no terms', () => {
    expect(defaultDueDate('card', '2026-09-05T21:11:00.000Z')).toBe('2026-09-05')
    expect(defaultDueDate(null, '2026-09-05T21:11:00.000Z')).toBe('2026-09-05')
    expect(defaultDueDate(undefined, '2026-09-05')).toBe('2026-09-05')
    expect(defaultDueDate('', '2026-09-05')).toBe('2026-09-05')
  })

  it('does NOT inherit the net_14 fallback that paymentTermDays uses', () => {
    // paymentTermDays('nonsense') answers 14. A due date must not, or an
    // unclassified client would quietly get a fortnight.
    expect(defaultDueDate('nonsense', '2026-09-05')).toBe('2026-09-05')
    expect(defaultDueDate('net_45', '2026-09-05')).toBe('2026-09-05')
  })

  it('adds the net days for each of the invoiced terms', () => {
    expect(defaultDueDate('net_7', '2026-09-05')).toBe('2026-09-12')
    expect(defaultDueDate('net_14', '2026-09-05')).toBe('2026-09-19')
    expect(defaultDueDate('net_30', '2026-09-05')).toBe('2026-10-05')
  })

  it('rolls over the end of a month', () => {
    expect(defaultDueDate('net_7', '2026-09-28')).toBe('2026-10-05')
    expect(defaultDueDate('net_30', '2026-01-31')).toBe('2026-03-02')
    // A leap February, so the same span lands a day earlier than 2026.
    expect(defaultDueDate('net_30', '2024-01-31')).toBe('2024-03-01')
    expect(defaultDueDate('net_7', '2024-02-26')).toBe('2024-03-04')
  })

  it('rolls over the end of a year', () => {
    expect(defaultDueDate('net_7', '2026-12-28')).toBe('2027-01-04')
    expect(defaultDueDate('net_30', '2026-12-31')).toBe('2027-01-30')
    expect(defaultDueDate('card', '2026-12-31')).toBe('2026-12-31')
  })

  it('keeps the day the UTC timestamp names, at either end of the day', () => {
    // 23:59 UTC. A local-time Date in NZDT (UTC+13) would read this as the
    // NEXT calendar day and bill a day late.
    expect(defaultDueDate('card', '2026-09-05T23:59:59.999Z')).toBe('2026-09-05')
    expect(defaultDueDate('net_7', '2026-09-05T23:59:59.999Z')).toBe('2026-09-12')
    // 00:00 UTC. A local-time Date west of Greenwich would read this as the
    // PREVIOUS day and bill a day early.
    expect(defaultDueDate('card', '2026-09-05T00:00:00.000Z')).toBe('2026-09-05')
    expect(defaultDueDate('net_14', '2026-09-05T00:00:00.000Z')).toBe('2026-09-19')
  })

  it('reads the day off the string, not off the reader clock', () => {
    // Same instant, two offsets. The YYYY-MM-DD prefix is what counts, so an
    // offset-bearing string is taken at its own face value rather than being
    // re-projected into whatever zone the machine is in.
    expect(defaultDueDate('net_7', '2026-09-05T09:00:00+12:00')).toBe('2026-09-12')
    expect(defaultDueDate('net_7', '2026-09-04T21:00:00Z')).toBe('2026-09-11')
  })

  it('leaves the field blank rather than guessing a date', () => {
    expect(defaultDueDate('net_7', '')).toBe('')
    expect(defaultDueDate('net_7', 'not a date')).toBe('')
    expect(defaultDueDate('net_7', '05/09/2026')).toBe('')
    // A day that does not exist is a bad string, not April 1st.
    expect(defaultDueDate('net_7', '2026-04-31')).toBe('')
    expect(defaultDueDate('net_7', '2026-13-01')).toBe('')
    expect(defaultDueDate('net_7', '2026-02-30')).toBe('')
  })
})

describe('localCalendarDay', () => {
  it('names the day the operator is looking at, zero padded', () => {
    // Constructed from local parts, so this assertion holds in any zone.
    expect(localCalendarDay(new Date(2026, 8, 6, 9, 0, 0))).toBe('2026-09-06')
    expect(localCalendarDay(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
    expect(localCalendarDay(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31')
  })

  it('agrees with the local date parts whatever zone the runner is in', () => {
    const now = new Date()
    const [year, month, day] = localCalendarDay(now).split('-').map(Number)
    expect(year).toBe(now.getFullYear())
    expect(month).toBe(now.getMonth() + 1)
    expect(day).toBe(now.getDate())
  })

  it('feeds defaultDueDate a day that is never yesterday', () => {
    // The bug this exists to stop: at 09:00 in NZDT the UTC day is still the
    // one before, so a card client would open already overdue.
    const nineAmNzdt = new Date(2026, 8, 6, 9, 0, 0)
    expect(defaultDueDate('card', localCalendarDay(nineAmNzdt))).toBe('2026-09-06')
  })

  it('is blank for an invalid clock rather than a fake day', () => {
    expect(localCalendarDay(new Date('nope'))).toBe('')
    expect(defaultDueDate('net_7', localCalendarDay(new Date('nope')))).toBe('')
  })
})

describe('defaultCurrency', () => {
  it('uses the client currency when it has one', () => {
    expect(defaultCurrency('USD')).toBe('USD')
    expect(defaultCurrency('AUD')).toBe('AUD')
  })

  it('normalises the free-text column', () => {
    expect(defaultCurrency(' usd ')).toBe('USD')
    expect(defaultCurrency('gbp')).toBe('GBP')
  })

  it('falls back when the client says nothing usable', () => {
    expect(DEFAULT_INVOICE_CURRENCY).toBe('NZD')
    expect(defaultCurrency(null)).toBe('NZD')
    expect(defaultCurrency(undefined)).toBe('NZD')
    expect(defaultCurrency('')).toBe('NZD')
    expect(defaultCurrency('   ')).toBe('NZD')
    expect(defaultCurrency('dollars')).toBe('NZD')
    expect(defaultCurrency(42)).toBe('NZD')
  })

  it('honours a caller-supplied fallback', () => {
    expect(defaultCurrency(null, 'USD')).toBe('USD')
  })

  it('falls back when the picker cannot offer the client currency', () => {
    const allowed = ['NZD', 'USD', 'AUD', 'GBP', 'EUR'] as const
    expect(defaultCurrency('CAD', 'NZD', allowed)).toBe('NZD')
    expect(defaultCurrency('eur', 'NZD', allowed)).toBe('EUR')
  })
})

describe('resolveChannelDefaults', () => {
  const answered = { loading: false, failed: false }
  const loading = { loading: true, failed: false }
  const failed = { loading: false, failed: true }

  it('uses the client rail and waits for nothing, even mid-flight', () => {
    const state = resolveChannelDefaults('xero', 'stripe', loading)
    expect(state.clientChannel).toBe('xero')
    expect(state.effectiveChannel).toBe('xero')
    expect(state.pending).toBe(false)
    expect(state.known).toBe(true)
  })

  it('keeps the client rail even when the studio read failed', () => {
    const state = resolveChannelDefaults('stripe', undefined, failed)
    expect(state.effectiveChannel).toBe('stripe')
    expect(state.known).toBe(true)
  })

  it('falls to the studio default for a client that names nothing', () => {
    const state = resolveChannelDefaults(null, 'xero', answered)
    expect(state.clientChannel).toBeNull()
    expect(state.effectiveChannel).toBe('xero')
    expect(state.pending).toBe(false)
    expect(state.known).toBe(true)
  })

  it('waits rather than guessing while the studio default is in flight', () => {
    const state = resolveChannelDefaults(null, undefined, loading)
    expect(state.pending).toBe(true)
    expect(state.known).toBe(false)
  })

  it('treats a failed studio read as unknown, not as Stripe', () => {
    const state = resolveChannelDefaults(null, undefined, failed)
    // It still has to name one of the two rails, so the caller is told not to
    // trust this one rather than being handed a null it has to re-handle.
    expect(state.effectiveChannel).toBe('stripe')
    expect(state.pending).toBe(false)
    expect(state.known).toBe(false)
  })

  it('reads an unrecognised client column as no channel at all', () => {
    // The three-rail draft of this feature wrote values like this one.
    const state = resolveChannelDefaults('xero_bank', 'xero', answered)
    expect(state.clientChannel).toBeNull()
    expect(state.effectiveChannel).toBe('xero')
    expect(state.known).toBe(true)
  })

  it('reads an empty or non-string client column as no channel at all', () => {
    expect(resolveChannelDefaults('', 'xero', answered).clientChannel).toBeNull()
    expect(resolveChannelDefaults(undefined, 'xero', answered).clientChannel).toBeNull()
    expect(resolveChannelDefaults(7, 'xero', answered).clientChannel).toBeNull()
  })

  it('lands on the studio-wide default when neither side says anything', () => {
    const state = resolveChannelDefaults(null, null, answered)
    expect(state.effectiveChannel).toBe('stripe')
    expect(state.known).toBe(true)
  })
})
