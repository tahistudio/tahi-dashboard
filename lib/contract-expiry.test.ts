import { describe, expect, it } from 'vitest'
import { contractExpiryDay, contractExpiryLabel, normalizeContractExpiry } from '@/lib/contract-expiry'
import { isContractPastExpiry } from '@/lib/contract-signing-state'

describe('normalizeContractExpiry', () => {
  it.each([
    ['2026-01-15', '2026-01-15T10:59:59.999Z'],
    ['2026-07-15', '2026-07-15T11:59:59.999Z'],
    ['2026-09-26', '2026-09-26T11:59:59.999Z'],
    ['2026-09-27', '2026-09-27T10:59:59.999Z'],
    ['2026-04-04', '2026-04-04T10:59:59.999Z'],
    ['2026-04-05', '2026-04-05T11:59:59.999Z'],
    ['2028-02-29', '2028-02-29T10:59:59.999Z'],
  ])('closes %s at the final millisecond of that Auckland day', (input, expected) => {
    const deadline = normalizeContractExpiry(input)
    expect(deadline).toBe(expected)
    expect(contractExpiryDay(deadline)).toBe(input)
  })

  it('trims a date-only input before choosing end of day', () => {
    expect(normalizeContractExpiry('  2026-09-30  ')).toBe('2026-09-30T10:59:59.999Z')
  })

  it.each([
    ['2026-09-30T23:59:59Z', '2026-09-30T23:59:59.000Z'],
    ['2026-09-30T23:59:59.000Z', '2026-09-30T23:59:59.000Z'],
    ['2026-09-30T23:59:59.123Z', '2026-09-30T23:59:59.123Z'],
    ['2026-09-30T23:59:59.999+13:00', '2026-09-30T10:59:59.999Z'],
    ['2026-07-15T23:59:59+12:00', '2026-07-15T11:59:59.000Z'],
    ['2026-09-30T23:59:59.123-04:00', '2026-10-01T03:59:59.123Z'],
  ])('preserves the absolute instant of %s, including legacy deadlines', (input, expected) => {
    expect(normalizeContractExpiry(input)).toBe(expected)
    expect(normalizeContractExpiry(expected)).toBe(expected)
  })

  it.each([
    ['2026-09-30T15:30', '2026-09-30T02:30:00.000Z'],
    ['2026-07-15T15:30:00', '2026-07-15T03:30:00.000Z'],
    ['2026-09-30T23:59:59.9', '2026-09-30T10:59:59.900Z'],
    ['2026-09-30T23:59:59.99', '2026-09-30T10:59:59.990Z'],
    ['2026-09-30T23:59:59.999', '2026-09-30T10:59:59.999Z'],
  ])('interprets naive ISO time %s in Auckland without fractional drift', (input, expected) => {
    expect(normalizeContractExpiry(input)).toBe(expected)
  })

  it.each([
    'not-a-date', '30/09/2026', '2026-13-01', '2026-00-10', '2026-01-00',
    '2026-02-29', '2026-02-30', '2026-04-31', '2026-02-30T23:59:59Z',
    '2026-02-29T15:30:00+13:00', '2026-09-30T25:00:00',
    '2026-09-30T23:60:00Z', '2026-09-30T23:59:60+13:00',
  ])('rejects invalid date or time %s rather than rolling it into another day', (input) => {
    expect(normalizeContractExpiry(input)).toBeNull()
  })

  it.each([null, '', '   '])('returns null for an absent deadline (%s)', (input) => {
    expect(normalizeContractExpiry(input)).toBeNull()
  })

  it.each([undefined, 0, false, 42, true, {}, []])('safely rejects non-string expiry input (%j)', (input) => {
    expect(normalizeContractExpiry(input)).toBeNull()
  })
})

describe('contractExpiryDay and contractExpiryLabel', () => {
  it.each(['2026-09-30T23:59:59Z', '2026-09-30T23:59:59.000Z'])('keeps the selected date of legacy %s visible', (legacy) => {
    expect(contractExpiryDay(legacy)).toBe('2026-09-30')
    // Display compatibility must not move the legal instant back by 13 hours.
    const label = contractExpiryLabel(legacy)
    expect(label).toContain('1 October 2026')
    expect(label).toMatch(/12:59\s*pm/)
    expect(label).toContain('(New Zealand time)')
  })

  it('formats a real Auckland deadline consistently for an overseas viewer', () => {
    const deadline = '2026-09-30T10:59:59.999Z'
    expect(contractExpiryDay(deadline)).toBe('2026-09-30')
    expect(contractExpiryLabel(deadline)).toMatch(/30 September 2026.*11:59\s*pm.*\(New Zealand time\)/)
  })

  it('uses Auckland for explicit instants that cross the UTC calendar day', () => {
    expect(contractExpiryDay('2026-09-30T11:00:00.000Z')).toBe('2026-10-01')
  })

  it.each([null, ''])('has an empty date input when the deadline is absent (%s)', (value) => {
    expect(contractExpiryDay(value)).toBe('')
  })
})

describe('contract signing deadline semantics', () => {
  const deadline = '2026-09-30T10:59:59.999Z'
  const instant = Date.parse(deadline)

  it.each(['draft', 'sent', 'partially_signed'])('keeps %s open through the deadline and lapses immediately afterward', (status) => {
    expect(isContractPastExpiry(status, deadline, instant - 1)).toBe(false)
    expect(isContractPastExpiry(status, deadline, instant)).toBe(false)
    expect(isContractPastExpiry(status, deadline, instant + 1)).toBe(true)
  })

  it.each(['signed', 'cancelled'])('retains the %s outcome after the signing deadline', (status) => {
    expect(isContractPastExpiry(status, deadline, instant + 1)).toBe(false)
  })

  it('treats an explicitly expired row as closed even without a deadline', () => {
    expect(isContractPastExpiry('expired', null, instant)).toBe(true)
  })
})
