import { describe, expect, it } from 'vitest'
import { invoiceAgeLabel, invoiceDaysPastDue, invoiceDueLabel, invoicePayState, invoiceStudioDay } from './invoice-pay-state'

const now = new Date('2026-10-10T12:00:00Z') // 11 October in Auckland.
const base = { status: 'sent', source: 'stripe', dueDate: '2026-10-10', createdAt: '2026-10-01T00:00:00Z' }
describe('invoice pay state', () => {
  it.each([
    [{ status: 'paid' }, 'paid', 'settled'],
    [{ status: 'written_off' }, 'void', 'voided'],
    [{ status: 'cancelled' }, 'void', 'voided'],
    [{ status: 'refunded' }, 'void', 'voided'],
    [{ status: 'draft', stripeHostedInvoiceUrl: 'https://old' }, 'pending', 'no link yet'],
    [{ status: ' Draft ', source: 'xero', xeroOnlineInvoiceUrl: 'https://old' }, 'pending', 'no link yet'],
    [{ stripeHostedInvoiceUrl: 'https://stripe' }, 'live', 'link live'],
    [{ stripeHostedInvoiceUrl: null }, 'missing', 'no link'],
    [{ source: 'xero', xeroOnlineInvoiceUrl: 'https://xero' }, 'live', 'pay page'],
    [{ source: 'xero', xeroInvoiceId: 'x_1' }, 'held', 'no pay page'],
    [{ source: 'xero' }, 'missing', 'not pushed'],
    [{ source: 'manual' }, 'bank', 'bank'],
    [{ source: null }, 'bank', 'bank'],
    [{ status: 'unknown', stripeHostedInvoiceUrl: 'https://old' }, 'pending', 'not issued'],
  ] as const)('derives %o without mistaking a draft or terminal state for a pay link', (fields, key, short) => {
    expect(invoicePayState({ ...base, ...fields })).toMatchObject({ key, short })
  })
  it('does not claim that a missing Xero URL proves draft status', () => {
    const pay = invoicePayState({ ...base, source: 'xero', xeroInvoiceId: 'x_1' })
    expect(pay.long).toContain('Check approval')
    expect(pay.long).not.toMatch(/held at draft|sitting at draft/i)
    expect(pay.long).toContain('Bank-transfer instructions may still be available')
  })
  it.each(['stripe', 'xero', 'manual', null])('honours either stored payment page on the %s rail', source => {
    expect(invoicePayState({ ...base, source, stripeHostedInvoiceUrl: ' https://stripe ' })).toMatchObject({ key: 'live', short: 'link live' })
    expect(invoicePayState({ ...base, source, stripeHostedInvoiceUrl: '   ', xeroOnlineInvoiceUrl: ' https://xero ' })).toMatchObject({ key: 'live', short: 'pay page' })
    expect(invoicePayState({ ...base, source, stripeHostedInvoiceUrl: ' https://stripe ', xeroOnlineInvoiceUrl: 'https://xero' })).toMatchObject({ key: 'live', short: 'link live' })
  })
  it('does not treat whitespace-only stored URLs as live pages', () => {
    expect(invoicePayState({ ...base, stripeHostedInvoiceUrl: ' ', xeroOnlineInvoiceUrl: '\t' }).key).toBe('missing')
    expect(invoicePayState({ ...base, source: 'xero', xeroInvoiceId: 'x_1', stripeHostedInvoiceUrl: '\n', xeroOnlineInvoiceUrl: ' ' }).key).toBe('held')
  })
  it.each(['draft', 'paid', 'written_off', 'void', 'refunded', 'unknown'])('keeps the %s status authoritative even when both payment pages are stored', status => {
    expect(invoicePayState({ ...base, status, stripeHostedInvoiceUrl: 'https://stripe', xeroOnlineInvoiceUrl: 'https://xero' }).key).not.toBe('live')
  })
})
describe('invoice calendar labels', () => {
  it('uses the Auckland day across UTC midnight and DST', () => {
    expect(invoiceStudioDay(now)).toBe('2026-10-11')
    expect(invoiceStudioDay(new Date('2026-09-26T12:30:00Z'))).toBe('2026-09-27')
    expect(invoiceDaysPastDue(base, now)).toBe(1)
    expect(invoiceDueLabel(base, now)).toBe('1 day overdue')
    expect(invoiceDueLabel({ ...base, dueDate: '2026-10-11' }, now)).toBe('Due today')
    expect(invoiceDueLabel({ ...base, dueDate: '2026-10-13' }, now)).toBe('Due in 2 days')
  })
  it.each(['draft', 'paid', 'written_off', 'cancelled', 'unknown'])('never ages %s as overdue', status => {
    expect(invoiceDaysPastDue({ ...base, status }, now)).toBe(0)
  })
  it('does not give an unknown status a negative due-in label', () => {
    expect(invoiceDueLabel({ ...base, status: 'unknown' }, now)).toBe('Not issued')
  })
  it.each([null, 'bad', '2026-02-30', '2026-13-01'])('rejects invalid due dates %s', dueDate => {
    expect(invoiceDaysPastDue({ ...base, dueDate }, now)).toBe(0)
    expect(invoiceDueLabel({ ...base, dueDate }, now)).toBe('No due date')
  })
  it('uses the real paid date for age, even after a write-off', () => {
    expect(invoiceAgeLabel({ ...base, status: 'written_off', paidAt: '2026-10-04T00:00:00Z' }, now)).toBe('Paid in 3 days')
    expect(invoiceAgeLabel({ ...base, status: 'draft' }, now)).toBe('10 days in draft')
    expect(invoiceAgeLabel(base, now)).toBe('10 days since raised')
  })
  it('does not invent a duration from malformed or reversed timestamps', () => {
    expect(invoiceAgeLabel({ ...base, paidAt: 'invalid' }, now)).toBe('Age unavailable')
    expect(invoiceAgeLabel({ ...base, paidAt: '2026-09-01T00:00:00Z' }, now)).toBe('Age unavailable')
  })
})
