/**
 * What a pinned client actually reads on a money figure stored in the base.
 *
 * A pin names the currency the client is BILLED in. It is not permission to
 * re-denominate a base figure, because the codebase does not agree with itself
 * about what a base figure is worth: lib/billing.ts calls PLAN_MONTHLY_RATES
 * "Monthly base rates in NZD" with maintain at 1500, while lib/stripe-plans.ts
 * charges maintain as US$1,500. Converting the NZD number lands on roughly
 * US$882, which is neither of the two prices anyone is charged, printed on a
 * screen whose next row is a real invoice.
 *
 * So the rule is: a base figure is shown in the base currency, exactly as it
 * is recorded. Native amounts (invoice totals) still carry the client's own
 * symbol, through formatNative, because those are facts rather than
 * conversions.
 */
import { describe, it, expect } from 'vitest'
import { BASE_CURRENCY, formatCurrency, formatPinnedBaseAmount } from '@/lib/currency'

describe('formatPinnedBaseAmount', () => {
  it('shows the base figure in the base currency, exactly as recorded', () => {
    expect(formatPinnedBaseAmount(1500)).toBe('NZ$1,500')
    expect(formatPinnedBaseAmount(4000)).toBe('NZ$4,000')
  })

  it('never re-denominates the plan rate into another currency', () => {
    const out = formatPinnedBaseAmount(1500)
    // The three shapes that were on the table, all of them stating a price
    // nobody charges: `US$882`, `NZ$1,500 US$882` and the marked variant.
    expect(out).not.toContain('US$')
    expect(out).not.toContain('≈')
    expect(out.match(/\$/g)).toHaveLength(1)
  })

  it('is the same figure the studio reads, so one plan has one number', () => {
    expect(formatPinnedBaseAmount(1500)).toBe(formatCurrency(1500, BASE_CURRENCY))
  })

  it('passes decimals through for line-item precision', () => {
    expect(formatPinnedBaseAmount(1500.5, { decimals: 2 })).toBe('NZ$1,500.50')
  })

  it('does not depend on exchange rates having loaded', () => {
    // The old shape printed a converted figure once rates arrived and the base
    // figure before that, so the same tile said two different numbers within a
    // second of each other. There is nothing left to arrive.
    expect(formatPinnedBaseAmount(1500)).toBe(formatPinnedBaseAmount(1500))
  })
})
