import { describe, it, expect } from 'vitest'
import {
  bucketInvoices,
  goalAmount,
  resolveChargeTwins,
  toInstantMs,
  type GoalInvoiceRow,
} from './income-goal-invoices'
import { computeIncomeGoal, INCOME_GOAL_SEGMENTS, pipelineDealPlacement } from './income-goal'

const START = '2026-11-01T00:00:00.000Z'
const END = '2026-12-01T00:00:00.000Z'
const NO_TWINS = { dropCharges: new Set<string>(), claimedInvoices: new Set<string>() }

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

describe('pipelineDealPlacement', () => {
  const cur = { isCurrentMonth: true, todayDate: '2026-11-20' }
  it('rolls a passed close date into the current month; no date stays out', () => {
    expect(pipelineDealPlacement('2026-11-15', '2026-11-01', '2026-12-01', cur)).toBe('in')
    expect(pipelineDealPlacement('2026-11-15T10:00:00Z', '2026-11-01', '2026-12-01', cur)).toBe('in')
    expect(pipelineDealPlacement('2026-10-02', '2026-11-01', '2026-12-01', cur)).toBe('rolled')
    expect(pipelineDealPlacement('2026-12-01', '2026-11-01', '2026-12-01', cur)).toBe('out')
    expect(pipelineDealPlacement(null, '2026-11-01', '2026-12-01', cur)).toBe('out')
    expect(pipelineDealPlacement('soon', '2026-11-01', '2026-12-01', cur)).toBe('out')
  })
  it('a deal more than 90 days overdue is stale; exactly 90 still counts', () => {
    expect(pipelineDealPlacement('2026-08-22', '2026-11-01', '2026-12-01', cur)).toBe('rolled') // 90 days
    expect(pipelineDealPlacement('2026-08-21', '2026-11-01', '2026-12-01', cur)).toBe('stale') // 91 days
  })
  it('a non-current month never rolls', () => {
    const past = { isCurrentMonth: false, todayDate: '2026-11-20' }
    expect(pipelineDealPlacement('2026-08-02', '2026-09-01', '2026-10-01', past)).toBe('out')
    expect(pipelineDealPlacement('2026-09-10', '2026-09-01', '2026-10-01', past)).toBe('in')
  })
})

describe('goalAmount (GST and credits)', () => {
  it('NZD uses amount minus discount, not total (INV-0071 shape)', () => {
    expect(goalAmount(row({ id: 'a', amountUsd: 3000, totalUsd: 3450 }))).toEqual({ amount: 3000, currency: 'NZD' })
    expect(goalAmount(row({ id: 'b', amountUsd: 3000, discountAmountUsd: 500, totalUsd: 2875 })).amount).toBe(2500)
  })
  it('Stripe in_ NZD is capped at total so an invoice discount is respected', () => {
    expect(goalAmount(row({ id: 's', source: 'stripe', amountUsd: 1000, totalUsd: 800 })).amount).toBe(800)
    expect(goalAmount(row({ id: 't', source: 'stripe', amountUsd: 1000, totalUsd: 1150 })).amount).toBe(1000)
  })
  it('blank currency is NZD; negatives floor at 0 for NZD and non-NZD alike', () => {
    expect(goalAmount(row({ id: 'c', currency: null, amountUsd: 100, discountAmountUsd: 300 })).amount).toBe(0)
    expect(goalAmount(row({ id: 'e', currency: 'USD', totalUsd: -50 })).amount).toBe(0)
  })
  it('non-NZD stays on total', () => {
    expect(goalAmount(row({ id: 'd', currency: 'USD', amountUsd: 1000, totalUsd: 1100 }))).toEqual({ amount: 1100, currency: 'USD' })
  })
})

describe('toInstantMs and month boundaries', () => {
  it('naive and Z timestamps are the same instant', () => {
    expect(toInstantMs('2026-11-01T00:00:00')).toBe(toInstantMs('2026-11-01T00:00:00.000Z'))
    expect(toInstantMs('2026-11-01')).toBe(toInstantMs('2026-11-01T00:00:00Z'))
  })
  it('reads /Date(ms)/ and returns null for garbage', () => {
    expect(toInstantMs('/Date(1793491200000+0000)/')).toBe(1793491200000)
    expect(toInstantMs('not a date')).toBeNull()
    expect(toInstantMs(null)).toBeNull()
  })
  it('a Xero invoice dated the 1st (naive) counts in its own month, not the previous', () => {
    const r = row({ id: '1', status: 'sent', sentAt: null, createdAt: '2026-11-01T00:00:00' })
    const nov = bucketInvoices([r], NO_TWINS, START, END)
    expect(nov.invoiced).toHaveLength(1)
    const oct = bucketInvoices([r], NO_TWINS, '2026-10-01T00:00:00.000Z', START)
    expect(oct.invoiced).toHaveLength(0)
    expect(oct.olderOutstanding).toHaveLength(0)
  })
  it('an invoice dated 1 Dec is not in November', () => {
    const b = bucketInvoices([row({ id: '1', createdAt: '2026-12-01T00:00:00' })], NO_TWINS, START, END)
    expect(b.invoiced).toHaveLength(0)
    expect(b.olderOutstanding).toHaveLength(0)
  })
  it('a /Date(...)/ paid_at lands in the right month', () => {
    // 1793491200000 = 2026-11-01T00:00:00Z ; 1793491199000 = 2026-10-31T23:59:59Z
    const inNov = row({ id: '1', status: 'paid', paidAt: '/Date(1793491200000+0000)/' })
    const inOct = row({ id: '2', status: 'paid', paidAt: '/Date(1793491199000+0000)/' })
    const b = bucketInvoices([inNov, inOct], NO_TWINS, START, END)
    expect(b.paid).toHaveLength(1)
  })
  it('an unreadable date is counted, never silently dropped', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'paid', paidAt: 'garbage' }),
      row({ id: '2', status: 'paid', paidAt: null }),
      row({ id: '3', status: 'sent', sentAt: 'garbage', createdAt: 'also garbage' }),
    ], NO_TWINS, START, END)
    expect(b.unknownDate).toBe(3)
    expect(b.paid).toHaveLength(0)
  })
})

describe('bucketInvoices', () => {
  it('paid needs a paid status and a paid_at inside the month', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'paid', paidAt: '2026-11-10T00:00:00.000Z' }),
      row({ id: '2', status: 'paid', paidAt: '2026-10-31T23:59:59.000Z' }),
      row({ id: '3', status: 'paid', paidAt: '2026-12-01T00:00:00.000Z' }),
      row({ id: '4', status: 'refunded', paidAt: '2026-11-10T00:00:00.000Z' }),
    ], NO_TWINS, START, END)
    expect(b.paid).toHaveLength(1)
  })

  it('invoice issued last month stays out of invoiced and lands in older outstanding', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'sent', sentAt: '2026-10-20T00:00:00.000Z' }),
      row({ id: '2', status: 'overdue', sentAt: null, createdAt: '2026-09-01T00:00:00.000Z' }),
      row({ id: '3', status: 'sent', sentAt: '2026-11-05T00:00:00.000Z' }),
      row({ id: '4', status: 'draft', sentAt: '2026-11-05T00:00:00.000Z' }),
    ], NO_TWINS, START, END)
    expect(b.invoiced).toHaveLength(1)
    expect(b.olderOutstanding).toHaveLength(2)
  })

  it('uses sent_at over created_at', () => {
    const b = bucketInvoices([
      row({ id: '1', sentAt: '2026-10-30T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' }),
      row({ id: '2', sentAt: null, createdAt: '2026-11-02T00:00:00.000Z' }),
    ], NO_TWINS, START, END)
    expect(b.olderOutstanding).toHaveLength(1)
    expect(b.invoiced).toHaveLength(1)
  })

  it('paid and owed can never overlap: an owed row with a paid_at is in no bucket', () => {
    const b = bucketInvoices([row({ id: '1', status: 'sent', paidAt: '2026-11-04T00:00:00.000Z' })], NO_TWINS, START, END)
    expect(b.invoiced).toHaveLength(0)
    expect(b.olderOutstanding).toHaveLength(0)
    expect(b.paid).toHaveLength(0)
  })
})

describe('resolveChargeTwins', () => {
  const stripeBase = { source: 'stripe', currency: 'NZD', totalUsd: 500, amountUsd: 500 }
  const inv = (over: Partial<GoalInvoiceRow> = {}) =>
    row({ id: 'in1', stripeInvoiceId: 'in_1', status: 'paid', paidAt: '2026-11-02T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z', ...stripeBase, ...over })
  const ch = (id: string, createdAt = '2026-11-03T00:00:00.000Z') =>
    row({ id, stripeInvoiceId: `ch_${id}`, status: 'paid', paidAt: createdAt, createdAt, ...stripeBase })

  it('in_ paid with paid_at: drop the ch_, keep the in_ in Paid', () => {
    const rows = [inv(), ch('c1')]
    const t = resolveChargeTwins(rows)
    expect([...t.dropCharges]).toEqual(['c1'])
    expect(t.claimedInvoices.size).toBe(0)
    const b = bucketInvoices(rows, t, START, END)
    expect(b.paid).toHaveLength(1)
    expect(b.twinsExcluded).toBe(1)
  })

  it.each(['sent', 'viewed', 'overdue'])('in_ %s + ch_ paid: keep the ch_ in Paid, leave the in_ out of Invoiced', status => {
    const rows = [inv({ status, paidAt: null, sentAt: '2026-11-02T00:00:00.000Z' }), ch('c1')]
    const t = resolveChargeTwins(rows)
    expect(t.dropCharges.size).toBe(0)
    expect([...t.claimedInvoices]).toEqual(['in1'])
    const b = bucketInvoices(rows, t, START, END)
    expect(b.paid).toHaveLength(1)
    expect(b.invoiced).toHaveLength(0)
    expect(b.olderOutstanding).toHaveLength(0)
  })

  it('a stale owed in_ from an older month is also left out of older outstanding when its charge exists', () => {
    const rows = [
      inv({ status: 'sent', paidAt: null, sentAt: '2026-10-30T00:00:00.000Z', createdAt: '2026-10-30T00:00:00.000Z' }),
      ch('c1', '2026-11-01T00:00:00.000Z'),
    ]
    const b = bucketInvoices(rows, resolveChargeTwins(rows), START, END)
    expect(b.olderOutstanding).toHaveLength(0)
    expect(b.paid).toHaveLength(1)
  })

  it.each(['void', 'written_off', 'draft'])('in_ %s: keep the ch_ and do not claim the in_', status => {
    const rows = [inv({ status, paidAt: null }), ch('c1')]
    const t = resolveChargeTwins(rows)
    expect(t.dropCharges.size).toBe(0)
    expect(t.claimedInvoices.size).toBe(0)
    expect(bucketInvoices(rows, t, START, END).paid).toHaveLength(1)
  })

  it('in_ paid but paid_at null: keep the ch_', () => {
    const rows = [inv({ paidAt: null }), ch('c1')]
    const t = resolveChargeTwins(rows)
    expect(t.dropCharges.size).toBe(0)
    expect(bucketInvoices(rows, t, START, END).paid).toHaveLength(1)
  })

  it('one in_ and two ch_ stays one to one: the closest is dropped, the other kept', () => {
    const rows = [inv(), ch('near', '2026-11-03T00:00:00.000Z'), ch('far', '2026-11-04T12:00:00.000Z')]
    const t = resolveChargeTwins(rows)
    expect([...t.dropCharges]).toEqual(['near'])
    expect(bucketInvoices(rows, t, START, END).paid).toHaveLength(2)
  })

  it('does not match a different amount, org or a late date', () => {
    expect(resolveChargeTwins([inv(), { ...ch('a'), totalUsd: 600 }]).dropCharges.size).toBe(0)
    expect(resolveChargeTwins([inv(), { ...ch('b'), orgId: 'other' }]).dropCharges.size).toBe(0)
    expect(resolveChargeTwins([inv(), ch('c', '2026-11-20T00:00:00.000Z')]).dropCharges.size).toBe(0)
  })

  it('the EUR 500 July 2025 case (ch_ paid, in_ written_off) counts in Paid', () => {
    const eur = { source: 'stripe', currency: 'EUR', totalUsd: 500, amountUsd: 500 }
    const rows = [
      row({ id: 'in', stripeInvoiceId: 'in_9', status: 'written_off', paidAt: null, createdAt: '2025-07-10T00:00:00.000Z', ...eur }),
      row({ id: 'ch', stripeInvoiceId: 'ch_9', status: 'paid', paidAt: '2025-07-11T00:00:00.000Z', createdAt: '2025-07-11T00:00:00.000Z', ...eur }),
    ]
    const b = bucketInvoices(rows, resolveChargeTwins(rows), '2025-07-01T00:00:00.000Z', '2025-08-01T00:00:00.000Z')
    expect(b.paid).toEqual([{ amount: 500, currency: 'EUR' }])
  })
})

describe('end to end through computeIncomeGoal', () => {
  it('older outstanding is reported but never moves projected or the gap', () => {
    const b = bucketInvoices([
      row({ id: '1', status: 'sent', sentAt: '2026-10-01T00:00:00.000Z', amountUsd: 40000 }),
      row({ id: '2', status: 'sent', sentAt: '2026-11-02T00:00:00.000Z', amountUsd: 2000 }),
    ], NO_TWINS, START, END)
    const r = computeIncomeGoal({
      targetMonthlyNzd: 10666.67,
      paid: b.paid, invoiced: b.invoiced, olderOutstanding: b.olderOutstanding,
      unbilled: [], pipeline: [], rates: [],
    })
    expect(r.projectedNzd).toBe(2000)
    expect(r.olderOutstandingNzd).toBe(40000)
    expect(r.gapNzd).toBe(8666.67)
  })

  it('wording never claims cash and states the caveats', () => {
    for (const seg of Object.values(INCOME_GOAL_SEGMENTS)) {
      expect(seg.definition.toLowerCase()).not.toMatch(/cash received|landed/)
    }
    expect(INCOME_GOAL_SEGMENTS.paid.definition).toContain('marked paid in Xero or Stripe')
    expect(INCOME_GOAL_SEGMENTS.unbilled.definition).toContain('double count')
    expect(INCOME_GOAL_SEGMENTS.pipeline.definition).toContain('90 days')
  })
})
