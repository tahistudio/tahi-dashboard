/**
 * lib/invoice-status.ts: the one vocabulary that decides what an invoice
 * status means to a number.
 *
 * The bug this file guards against, in the founder's words: "I have drafted
 * invoices in Xero ... the only problem is it is marking those drafts as money
 * owed in the reporting on the dashboard or the home page." So the assertion
 * that matters most is the boring one: a draft is not owed, is not paid, is
 * not revenue, and is not settled either.
 */
import { describe, it, expect } from 'vitest'
import {
  DRAFT_STATUSES,
  OWED_STATUSES,
  PAID_STATUSES,
  VOID_STATUSES,
  draftInvoiceTotal,
  draftStatusList,
  isDraftInvoice,
  isIssuedInvoice,
  isOwedInvoice,
  isPaidInvoice,
  isVoidInvoice,
  issuedStatusList,
  normaliseInvoiceStatus,
  owedStatusList,
  paidStatusList,
  partitionInvoicesByStatus,
} from '@/lib/invoice-status'
import { SETTLED_INVOICE_STATUSES, isInvoiceSettled } from '@/lib/invoice-how-to-pay'

describe('a draft is never money', () => {
  it('is not owed, paid, void, issued or settled', () => {
    expect(isDraftInvoice('draft')).toBe(true)
    expect(isOwedInvoice('draft')).toBe(false)
    expect(isPaidInvoice('draft')).toBe(false)
    expect(isVoidInvoice('draft')).toBe(false)
    expect(isIssuedInvoice('draft')).toBe(false)
    expect(isInvoiceSettled({ status: 'draft' })).toBe(false)
  })

  it('is not in the owed, paid, issued or settled query lists', () => {
    expect(owedStatusList()).not.toContain('draft')
    expect(paidStatusList()).not.toContain('draft')
    expect(issuedStatusList()).not.toContain('draft')
    expect(SETTLED_INVOICE_STATUSES).not.toContain('draft')
  })

  it('survives a stored value with odd case or whitespace', () => {
    // invoices.status is untyped TEXT written by three importers, so a stray
    // " Draft " must not slip past the bucket test and become money.
    expect(isDraftInvoice(' Draft ')).toBe(true)
    expect(isOwedInvoice(' Draft ')).toBe(false)
    expect(isOwedInvoice('SENT')).toBe(true)
  })
})

describe('the four buckets', () => {
  it('counts every issued-and-unpaid status as owed', () => {
    for (const status of OWED_STATUSES) {
      expect(isOwedInvoice(status)).toBe(true)
      expect(isDraftInvoice(status)).toBe(false)
      expect(isIssuedInvoice(status)).toBe(true)
    }
    // `viewed` is a read receipt on a sent invoice, not a different debt.
    expect(isOwedInvoice('viewed')).toBe(true)
  })

  it('counts paid as revenue and not as owed', () => {
    for (const status of PAID_STATUSES) {
      expect(isPaidInvoice(status)).toBe(true)
      expect(isOwedInvoice(status)).toBe(false)
      expect(isIssuedInvoice(status)).toBe(true)
    }
  })

  it('counts a dead invoice as neither owed nor revenue', () => {
    for (const status of VOID_STATUSES) {
      expect(isVoidInvoice(status)).toBe(true)
      expect(isOwedInvoice(status)).toBe(false)
      expect(isPaidInvoice(status)).toBe(false)
      expect(isIssuedInvoice(status)).toBe(false)
    }
  })

  it('keeps the four bucket lists disjoint', () => {
    const all = [...DRAFT_STATUSES, ...OWED_STATUSES, ...PAID_STATUSES, ...VOID_STATUSES]
    expect(new Set(all).size).toBe(all.length)
  })

  it('treats an unrecognised status as no kind of money', () => {
    for (const check of [isDraftInvoice, isOwedInvoice, isPaidInvoice, isVoidInvoice, isIssuedInvoice]) {
      expect(check('something_new')).toBe(false)
      expect(check(null)).toBe(false)
      expect(check(undefined)).toBe(false)
      expect(check(42)).toBe(false)
    }
  })

  it('normalises to a bare lower-case string', () => {
    expect(normaliseInvoiceStatus('  PAID ')).toBe('paid')
    expect(normaliseInvoiceStatus(null)).toBe('')
    expect(normaliseInvoiceStatus(7)).toBe('')
  })
})

describe('the query lists', () => {
  it('hands out a fresh array each call, so a caller cannot mutate the source', () => {
    const first = owedStatusList()
    first.push('draft')
    expect(owedStatusList()).not.toContain('draft')
    expect(draftStatusList()).toEqual(['draft'])
  })

  it('makes issued the union of owed and paid', () => {
    expect([...issuedStatusList()].sort())
      .toEqual([...OWED_STATUSES, ...PAID_STATUSES].sort())
  })
})

describe('partitionInvoicesByStatus', () => {
  const rows = [
    { id: 'a', status: 'draft', amount: 4200 },
    { id: 'b', status: 'sent', amount: 1000 },
    { id: 'c', status: 'viewed', amount: 500 },
    { id: 'd', status: 'overdue', amount: 250 },
    { id: 'e', status: 'paid', amount: 9000 },
    { id: 'f', status: 'written_off', amount: 700 },
    { id: 'g', status: 'martian', amount: 1 },
  ]

  it('puts every row in exactly one bucket', () => {
    const p = partitionInvoicesByStatus(rows)
    expect(p.drafts.map(r => r.id)).toEqual(['a'])
    expect(p.owed.map(r => r.id)).toEqual(['b', 'c', 'd'])
    expect(p.paid.map(r => r.id)).toEqual(['e'])
    expect(p.voided.map(r => r.id)).toEqual(['f'])
    expect(p.unknown.map(r => r.id)).toEqual(['g'])
    const total = p.drafts.length + p.owed.length + p.paid.length + p.voided.length + p.unknown.length
    expect(total).toBe(rows.length)
  })

  it('keeps the draft out of the owed total', () => {
    const p = partitionInvoicesByStatus(rows)
    const owedTotal = p.owed.reduce((s, r) => s + r.amount, 0)
    // 1000 + 500 + 250. The 4200 draft is not in it, which is the whole point.
    expect(owedTotal).toBe(1750)
  })
})

describe('draftInvoiceTotal', () => {
  it('reports the drafts figure the studio surfaces print', () => {
    const rows = [
      { status: 'draft', amount: 3000 },
      { status: 'draft', amount: 1200 },
      { status: 'sent', amount: 9999 },
      { status: 'paid', amount: 5555 },
    ]
    expect(draftInvoiceTotal(rows, r => r.amount)).toEqual({ count: 2, total: 4200 })
  })

  it('is zero when nothing is in draft', () => {
    expect(draftInvoiceTotal([{ status: 'sent', amount: 10 }], r => r.amount))
      .toEqual({ count: 0, total: 0 })
  })
})

describe('isInvoiceSettled, derived from the same buckets', () => {
  it('settles paid and every dead status, and nothing else', () => {
    expect(isInvoiceSettled({ status: 'paid' })).toBe(true)
    expect(isInvoiceSettled({ status: 'written_off' })).toBe(true)
    expect(isInvoiceSettled({ status: 'cancelled' })).toBe(true)
    expect(isInvoiceSettled({ status: 'refunded' })).toBe(true)
    expect(isInvoiceSettled({ status: 'sent' })).toBe(false)
    expect(isInvoiceSettled({ status: 'viewed' })).toBe(false)
  })

  it('still settles on a paid date the status has not caught up with', () => {
    expect(isInvoiceSettled({ status: 'sent', paidAt: '2026-09-01T00:00:00.000Z' })).toBe(true)
  })
})
