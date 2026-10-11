import { describe, expect, it } from 'vitest'
import { DEFAULT_INVOICE_FILTERS, filterInvoiceRows, invoiceBandRows, invoiceMoneyTotal, invoicePaidThisMonth, invoiceViewCounts, type StudioInvoice } from '../invoice-views'

const now = new Date('2026-10-10T12:00:00Z')
const base: StudioInvoice = {
  id: 'inv', orgId: 'org-a', orgName: 'Client A', number: 'INV-001', status: 'sent', source: 'stripe',
  currency: 'NZD', totalAmount: 100, dueDate: '2026-10-01', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}
const row = (over: Partial<StudioInvoice> = {}) => ({ ...base, ...over })
const rates = [{ currency: 'NZD', rateToUsd: 1.6 }, { currency: 'USD', rateToUsd: 1 }, { currency: 'GBP', rateToUsd: 0.8 }]
describe('invoice views and honest band buckets', () => {
  const invoices = [
    row({ id: 'draft', status: 'draft', paidAt: '2026-10-05T00:00:00Z', totalAmount: 99999 }),
    row({ id: 'sent', source: 'manual' }), row({ id: 'viewed', status: 'viewed' }),
    row({ id: 'pending', status: 'pending', dueDate: null, stripeHostedInvoiceUrl: 'https://stripe' }),
    row({ id: 'held', source: 'xero', xeroInvoiceId: 'x_1' }),
    row({ id: 'paid', status: 'paid', paidAt: '2026-10-03T00:00:00Z' }),
    row({ id: 'writeoff', status: 'written_off', paidAt: '2026-10-04T00:00:00Z' }),
    row({ id: 'unknown', status: 'unknown' }),
  ]
  it('shares owed semantics for viewed and legacy pending, excludes draft and terminal debts', () => {
    expect(invoiceViewCounts(invoices, now)).toEqual({ all: 8, owed: 4, overdue: 3, no_pay: 2, paid_month: 1, drafts: 1 })
    const band = invoiceBandRows(invoices, now)
    expect(band.owed.map(inv => inv.id)).toEqual(['sent', 'viewed', 'pending', 'held'])
    expect(band.collected.map(inv => inv.id)).toEqual(['paid'])
    expect(band.drafts.map(inv => inv.id)).toEqual(['draft'])
    expect(invoiceMoneyTotal(band.owed, 'NZD', []).total).toBe(400)
    expect(invoiceMoneyTotal(band.collected, 'NZD', []).total).toBe(100)
  })
  it('uses the Auckland payment month and never guesses from status or creation date', () => {
    const month = new Date('2026-09-30T12:00:00Z') // 1 October in Auckland.
    expect(invoicePaidThisMonth(row({ status: 'paid', paidAt: '2026-09-30T10:59:59Z' }), month)).toBe(false)
    expect(invoicePaidThisMonth(row({ status: 'paid', paidAt: '2026-09-30T11:00:00Z' }), month)).toBe(true)
    expect(invoicePaidThisMonth(row({ status: 'paid', paidAt: '2026-10-31T11:00:00Z' }), month)).toBe(false)
    expect(invoicePaidThisMonth(row({ status: 'paid', paidAt: 'invalid' }), month)).toBe(false)
    expect(invoicePaidThisMonth(row({ status: 'paid', paidAt: null }), month)).toBe(false)
  })
  it('counts missing payment pages without hiding alternate rail URLs or promising there is no way to pay', () => {
    const rows = [
      row({ id: 'stripe-fallback', xeroOnlineInvoiceUrl: 'https://xero' }),
      row({ id: 'xero-fallback', source: 'xero', stripeHostedInvoiceUrl: 'https://stripe' }),
      row({ id: 'blank', stripeHostedInvoiceUrl: ' ', xeroOnlineInvoiceUrl: '\t' }),
      row({ id: 'xero-bank', source: 'xero', xeroInvoiceId: 'x_1' }),
      row({ id: 'manual-bank', source: 'manual' }),
      row({ id: 'draft', status: 'draft' }),
      row({ id: 'paid', status: 'paid' }),
    ]
    expect(filterInvoiceRows(rows, 'no_pay', DEFAULT_INVOICE_FILTERS, '', now).map(inv => inv.id)).toEqual(['blank', 'xero-bank'])
    expect(invoiceViewCounts(rows, now).no_pay).toBe(2)
  })
  it.each(['draft', 'sent', 'viewed', 'pending', 'overdue', 'written_off', 'void', 'voided', 'refunded', 'cancelled', 'unknown'])('does not count %s as collected even with a paid timestamp', status => {
    const invoice = row({ status, paidAt: '2026-10-03T00:00:00Z' })
    expect(invoicePaidThisMonth(invoice, now)).toBe(false)
    expect(invoiceBandRows([invoice], now).collected).toEqual([])
    expect(invoiceViewCounts([invoice], now).paid_month).toBe(0)
  })
  it('filters independent due bounds, leaving undated rows out of a due range', () => {
    const rows = [row({ id: 'a', dueDate: '2026-10-01' }), row({ id: 'b', dueDate: '2026-10-15' }), row({ id: 'c', dueDate: null })]
    const filter = (over: Partial<typeof DEFAULT_INVOICE_FILTERS>) => filterInvoiceRows(rows, 'all', { ...DEFAULT_INVOICE_FILTERS, ...over }, '', now).map(inv => inv.id)
    expect(filter({ from: '2026-10-02' })).toEqual(['b'])
    expect(filter({ to: '2026-10-10' })).toEqual(['a'])
    expect(filter({ from: '2026-10-15', to: '2026-10-15' })).toEqual(['b'])
    expect(filter({ from: '2026-10-20', to: '2026-10-01' })).toEqual([])
  })
  it.each(['client a', 'INV-001', 'stripe_external', 'xero_external', 'inv'])('searches the complete row identity for %s', query => {
    const matched = row({ stripeInvoiceId: 'stripe_external', xeroInvoiceId: 'xero_external' })
    expect(filterInvoiceRows([matched], 'all', DEFAULT_INVOICE_FILTERS, query, now)).toEqual([matched])
  })
  it('intersects view, status, client and rail instead of resetting filters', () => {
    expect(filterInvoiceRows(invoices, 'owed', { ...DEFAULT_INVOICE_FILTERS, status: 'overdue', source: 'xero', client: 'org-a' }, '', now).map(inv => inv.id)).toEqual(['held'])
    expect(filterInvoiceRows(invoices, 'drafts', { ...DEFAULT_INVOICE_FILTERS, status: 'paid' }, '', now)).toEqual([])
  })
})
describe('validated multi-currency invoice totals', () => {
  it('converts each native amount before summing and follows the display currency', () => {
    const rows = [row({ totalAmount: 100 }), row({ totalAmount: 100, currency: 'USD' }), row({ totalAmount: 100, currency: 'GBP' })]
    expect(invoiceMoneyTotal(rows, 'NZD', rates)).toMatchObject({ total: 460, currency: 'NZD', converted: true })
    expect(invoiceMoneyTotal(rows, 'USD', rates).total).toBe(287.5)
    expect(invoiceMoneyTotal(rows, 'GBP', rates).total).toBe(230)
  })
  it('groups native amounts rather than relabelling unconverted dollars when FX is unavailable', () => {
    const money = invoiceMoneyTotal([row(), row({ currency: 'usd', totalAmount: 50 }), row({ currency: 'USD', totalAmount: 25 })], 'GBP', [])
    expect(money).toEqual({ total: null, currency: 'GBP', converted: false, invalidAmount: false, native: [{ currency: 'NZD', total: 100 }, { currency: 'USD', total: 75 }] })
  })
  it.each([0, -1, NaN, Infinity])('rejects a nonpositive or nonfinite source rate %s', rateToUsd => {
    expect(invoiceMoneyTotal([row({ currency: 'USD' })], 'NZD', [rates[0], { currency: 'USD', rateToUsd }]).total).toBeNull()
  })
  it('rejects missing NZD, missing destination, and duplicated rate rows', () => {
    expect(invoiceMoneyTotal([row({ currency: 'USD' })], 'GBP', rates.slice(1)).total).toBeNull()
    expect(invoiceMoneyTotal([row()], 'AUD', rates).total).toBeNull()
    expect(invoiceMoneyTotal([row({ currency: 'USD' })], 'NZD', [...rates, rates[1]]).total).toBeNull()
  })
  it('needs no FX for matching native currency, including the empty ledger and legacy null NZD', () => {
    expect(invoiceMoneyTotal([row({ currency: 'USD' })], 'USD', []).total).toBe(100)
    expect(invoiceMoneyTotal([row({ currency: null })], 'NZD', []).total).toBe(100)
    expect(invoiceMoneyTotal([], 'GBP', [])).toMatchObject({ total: 0, converted: false })
  })
  it('withholds an aggregate with a malformed amount or overflowing total', () => {
    expect(invoiceMoneyTotal([row({ totalAmount: NaN })], 'NZD', [])).toMatchObject({ total: null, invalidAmount: true })
    expect(invoiceMoneyTotal([row({ totalAmount: Number.MAX_VALUE }), row({ totalAmount: Number.MAX_VALUE })], 'NZD', [])).toMatchObject({ total: null, invalidAmount: true })
  })
})
