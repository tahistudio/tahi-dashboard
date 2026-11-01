import { describe, it, expect } from 'vitest'
import { bucketInvoices, chargeTwinIds, goalAmount, type GoalInvoiceRow } from './income-goal-invoices'
import { computeIncomeGoal, INCOME_GOAL_SEGMENTS, pipelineDealPlacement } from './income-goal'

describe('pipelineDealPlacement', () => {
  it('rolls a passed close date into the month; no date stays out', () => {
    expect(pipelineDealPlacement('2026-11-15', '2026-11-01', '2026-12-01')).toBe('in')
    expect(pipelineDealPlacement('2026-11-15T10:00:00Z', '2026-11-01', '2026-12-01')).toBe('in')
    expect(pipelineDealPlacement('2026-08-02', '2026-11-01', '2026-12-01')).toBe('rolled')
    expect(pipelineDealPlacement('2026-12-01', '2026-11-01', '2026-12-01')).toBe('out')
    expect(pipelineDealPlacement(null, '2026-11-01', '2026-12-01')).toBe('out')
    expect(pipelineDealPlacement('', '2026-11-01', '2026-12-01')).toBe('out')
    expect(pipelineDealPlacement('soon', '2026-11-01', '2026-12-01')).toBe('out')
  })
})

const START = '2026-11-01T00:00:00.000Z'
const END = '2026-12-01T00:00:00.000Z'

function row(over: Partial<GoalInvoiceRow> & { id: string }): GoalInvoiceRow {
  return {
    orgId: 'org1',
    stripeInvoiceId: null,
    source: 'xero',
    status: 'sent',
    amountUsd: 1000,
    discountAmountUsd: 0,
    totalUsd: 1150,
    currency: 'NZD',
    createdAt: '2026-11-03T00:00:00.000Z',
    sentAt: null,
    paidAt: null,
    manyrequestsId: null,
    xeroInvoiceId: null,
    ...over,
  }
}

describe('goalAmount (GST)', () => {
  it('NZD uses amount minus discount, not total (INV-0071 shape)', () => {
    expect(goalAmount(row({ id: 'a', amountUsd: 3000, totalUsd: 3450 }))).toEqual({ amount: 3000, currency: 'NZD' })
    expect(goalAmount(row({ id: 'b', amountUsd: 3000, discountAmountUsd: 500, totalUsd: 2875 })).amount).toBe(2500)
  })
  it('blank currency is NZD; discount larger than amount floors at 0', () => {
    expect(goalAmount(row({ id: 'c', currency: null, amountUsd: 100, discountAmountUsd: 300 })).amount).toBe(0)
  })
  it('non-NZD stays on total', () => {
    expect(goalAmount(row({ id: 'd', currency: 'USD', amountUsd: 1000, totalUsd: 1100 }))).toEqual({ amount: 1100, currency: 'USD' })
  })
})

describe('bucketInvoices', () => {
  it('paid needs a paid status and a paid_at inside the month', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'paid', paidAt: '2026-11-10T00:00:00.000Z' }),
      row({ id: '2', status: 'paid', paidAt: '2026-10-31T23:59:59.000Z' }),
      row({ id: '3', status: 'paid', paidAt: '2026-12-01T00:00:00.000Z' }),
      row({ id: '4', status: 'refunded', paidAt: '2026-11-10T00:00:00.000Z' }),
    ], new Set(), START, END)
    expect(b.paid).toHaveLength(1)
  })

  it('invoice issued last month stays out of invoiced and lands in older outstanding', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'sent', sentAt: '2026-10-20T00:00:00.000Z' }),
      row({ id: '2', status: 'overdue', sentAt: null, createdAt: '2026-09-01T00:00:00.000Z' }),
      row({ id: '3', status: 'sent', sentAt: '2026-11-05T00:00:00.000Z' }),
      row({ id: '4', status: 'draft', sentAt: '2026-11-05T00:00:00.000Z' }),
    ], new Set(), START, END)
    expect(b.invoiced).toHaveLength(1)
    expect(b.olderOutstanding).toHaveLength(2)
  })

  it('uses sent_at over created_at, and created_at when sent_at is missing', () => {
    const b = bucketInvoices([
      row({ id: '1', sentAt: '2026-10-30T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' }),
      row({ id: '2', sentAt: null, createdAt: '2026-11-02T00:00:00.000Z' }),
    ], new Set(), START, END)
    expect(b.olderOutstanding).toHaveLength(1)
    expect(b.invoiced).toHaveLength(1)
  })

  it('paid and owed can never overlap: an owed row with a paid_at is in neither unpaid bucket', () => {
    const b = bucketInvoices([row({ id: '1', status: 'sent', paidAt: '2026-11-04T00:00:00.000Z' })], new Set(), START, END)
    expect(b.invoiced).toHaveLength(0)
    expect(b.olderOutstanding).toHaveLength(0)
    expect(b.paid).toHaveLength(0)
  })

  it('leaves twins out of paid and invoiced and counts them', () => {
    const b = bucketInvoices([
      row({ id: 'p', status: 'paid', paidAt: '2026-11-04T00:00:00.000Z' }),
      row({ id: 'p2', status: 'paid', paidAt: '2026-11-04T00:00:00.000Z' }),
      row({ id: 'u', status: 'sent', sentAt: '2026-11-04T00:00:00.000Z' }),
    ], new Set(['p2', 'u']), START, END)
    expect(b.paid).toHaveLength(1)
    expect(b.invoiced).toHaveLength(0)
    expect(b.twinsExcluded).toBe(2)
  })
})

describe('chargeTwinIds', () => {
  const inv = row({
    id: 'in1', source: 'stripe', stripeInvoiceId: 'in_1', status: 'paid', currency: 'NZD',
    totalUsd: 500, amountUsd: 500, createdAt: '2026-11-02T00:00:00.000Z',
  })
  it('flags a ch_ row with an in_ twin (same org, amount, 3 day window)', () => {
    const ch = row({
      id: 'ch1', source: 'stripe', stripeInvoiceId: 'ch_1', status: 'paid', currency: 'NZD',
      totalUsd: 500, amountUsd: 500, createdAt: '2026-11-03T00:00:00.000Z',
    })
    const py = row({
      id: 'py1', source: 'stripe', stripeInvoiceId: 'py_1', status: 'paid', currency: 'NZD',
      totalUsd: 500, amountUsd: 500, createdAt: '2026-11-04T00:00:00.000Z',
    })
    // one in_ pairs with only one charge (one to one), the closest.
    const ids = chargeTwinIds([inv, ch, py])
    expect([...ids]).toEqual(['ch1'])
  })
  it('does not flag a charge with a different amount, org or a late date', () => {
    const base = { source: 'stripe', stripeInvoiceId: 'ch_9', status: 'paid', currency: 'NZD', amountUsd: 500 }
    expect(chargeTwinIds([inv, row({ id: 'a', ...base, totalUsd: 600, createdAt: '2026-11-02T00:00:00.000Z' })]).size).toBe(0)
    expect(chargeTwinIds([inv, row({ id: 'b', ...base, totalUsd: 500, orgId: 'other', createdAt: '2026-11-02T00:00:00.000Z' })]).size).toBe(0)
    expect(chargeTwinIds([inv, row({ id: 'c', ...base, totalUsd: 500, createdAt: '2026-11-20T00:00:00.000Z' })]).size).toBe(0)
  })
})

describe('end to end through computeIncomeGoal', () => {
  it('older outstanding is reported but never moves projected or the gap', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'sent', sentAt: '2026-10-01T00:00:00.000Z', amountUsd: 40000 }),
      row({ id: '2', status: 'sent', sentAt: '2026-11-02T00:00:00.000Z', amountUsd: 2000 }),
    ], new Set(), START, END)
    const r = computeIncomeGoal({
      targetMonthlyNzd: 10666.67,
      paid: b.paid, invoiced: b.invoiced, olderOutstanding: b.olderOutstanding,
      unbilled: [], pipeline: [], rates: [],
    })
    expect(r.projectedNzd).toBe(2000)
    expect(r.olderOutstandingNzd).toBe(40000)
    expect(r.gapNzd).toBe(8666.67)
  })

  it('wording never claims cash', () => {
    for (const seg of Object.values(INCOME_GOAL_SEGMENTS)) {
      expect(seg.definition.toLowerCase()).not.toMatch(/cash received|landed/)
    }
    expect(INCOME_GOAL_SEGMENTS.paid.definition).toContain('marked paid in Xero or Stripe')
    expect(INCOME_GOAL_SEGMENTS.unbilled.definition).toContain('double count')
    expect(INCOME_GOAL_SEGMENTS.pipeline.definition).toContain('already passed')
  })
})
