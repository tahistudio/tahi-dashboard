/**
 * MRR Hero delta label (2026-09-19 fix).
 *
 * The Hero always read "vs last month" whenever a delta existed, even when
 * the prior snapshot was two or more months old (a skipped snapshot-metrics
 * cron day). This checks the label actually names the basis month, and
 * calls out a skipped month rather than passing it off as "last month".
 */
import { describe, it, expect } from 'vitest'
import { mrrDeltaLabel } from '@/components/tahi/overview/homes/owner-home'

// "Now" is September 2026, so the expected prior month is August.
const NOW = new Date('2026-09-19T00:00:00.000Z')

describe('mrrDeltaLabel', () => {
  it('reads "vs last month" when there is no basis month at all', () => {
    expect(mrrDeltaLabel(null, NOW)).toBe('vs last month')
    expect(mrrDeltaLabel(undefined, NOW)).toBe('vs last month')
  })

  it('names the short month when the basis is exactly last calendar month', () => {
    expect(mrrDeltaLabel('2026-08', NOW)).toBe('vs Aug')
  })

  it('calls out a skipped snapshot when the basis is more than one month back', () => {
    // Basis is July; August's snapshot never landed.
    expect(mrrDeltaLabel('2026-07', NOW)).toBe('vs Jul (no Aug snapshot)')
  })

  it('calls out a skipped snapshot across a year boundary', () => {
    const jan = new Date('2027-01-15T00:00:00.000Z')
    // Basis is November; December's snapshot never landed.
    expect(mrrDeltaLabel('2026-11', jan)).toBe('vs Nov (no Dec snapshot)')
  })
})
