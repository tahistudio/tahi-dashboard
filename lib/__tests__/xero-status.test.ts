/**
 * lib/xero-status.ts: the one Xero-to-dashboard status table.
 *
 * Three mappers used to disagree, so the same Xero invoice read 'sent' or
 * 'viewed' depending on which job touched it last. These tests pin every Xero
 * status the API can hand back, the settled-balance refinement, the guard that
 * stops a Xero sync flattening the local-only 'viewed' and 'overdue' states,
 * and the date normalisation that keeps paid_at comparable in /financial-reports.
 */
import { describe, it, expect } from 'vitest'
import {
  mapXeroInvoiceStatus,
  mapXeroInvoiceStatusForKnownRow,
  reconcileXeroStatus,
  resolveXeroStatusWrite,
  shouldUnwindPaidAt,
  UNWINDS_PAYMENT,
  normaliseXeroDate,
} from '@/lib/xero-status'

describe('mapXeroInvoiceStatus', () => {
  it('maps every Xero invoice status', () => {
    expect(mapXeroInvoiceStatus('DRAFT')).toBe('draft')
    expect(mapXeroInvoiceStatus('SUBMITTED')).toBe('sent')
    expect(mapXeroInvoiceStatus('AUTHORISED')).toBe('sent')
    expect(mapXeroInvoiceStatus('PAID')).toBe('paid')
    expect(mapXeroInvoiceStatus('VOIDED')).toBe('written_off')
    // Deleted before it was ever issued: no dashboard status, importer skips.
    expect(mapXeroInvoiceStatus('DELETED')).toBeNull()
  })

  it('reads SUBMITTED exactly like AUTHORISED', () => {
    // The old payment sync called this one 'viewed', which also meant "the
    // client opened the invoice in the portal". Two meanings, one column.
    expect(mapXeroInvoiceStatus('SUBMITTED')).toBe(mapXeroInvoiceStatus('AUTHORISED'))
  })

  it('has no opinion on an unknown or missing status', () => {
    expect(mapXeroInvoiceStatus('PENDING')).toBeNull()
    expect(mapXeroInvoiceStatus('')).toBeNull()
    expect(mapXeroInvoiceStatus(null)).toBeNull()
    expect(mapXeroInvoiceStatus(undefined)).toBeNull()
  })

  it('calls a settled AUTHORISED invoice paid when Xero lags the PAID flag', () => {
    expect(mapXeroInvoiceStatus('AUTHORISED', 0, '2026-09-01')).toBe('paid')
    expect(mapXeroInvoiceStatus('SUBMITTED', 0, '2026-09-01')).toBe('paid')
  })

  it('needs both a zero balance and a paid date before saying paid', () => {
    // A zero-value invoice has a zero balance and no paid date, and IC.1 made
    // paid-with-a-null-paid-date an error state.
    expect(mapXeroInvoiceStatus('AUTHORISED', 0, null)).toBe('sent')
    expect(mapXeroInvoiceStatus('AUTHORISED', 0, '')).toBe('sent')
    expect(mapXeroInvoiceStatus('AUTHORISED', 250, '2026-09-01')).toBe('sent')
    expect(mapXeroInvoiceStatus('AUTHORISED', undefined, '2026-09-01')).toBe('sent')
  })

  it('does not let the balance refinement resurrect a draft or a void', () => {
    expect(mapXeroInvoiceStatus('DRAFT', 0, '2026-09-01')).toBe('draft')
    expect(mapXeroInvoiceStatus('VOIDED', 0, '2026-09-01')).toBe('written_off')
    expect(mapXeroInvoiceStatus('DELETED', 0, '2026-09-01')).toBeNull()
  })
})

describe('mapXeroInvoiceStatusForKnownRow', () => {
  it('reads DELETED as a write-off on a row the dashboard already holds', () => {
    // The create path has to return null (nothing honest to insert), but on a
    // row we hold, null means "leave it alone" and a 'sent' invoice whose Xero
    // counterpart no longer exists then sits in the client portal as payable
    // forever: the payment sync says 'not_found_in_xero' and the importer
    // never sees it again.
    expect(mapXeroInvoiceStatus('DELETED')).toBeNull()
    expect(mapXeroInvoiceStatusForKnownRow('DELETED')).toBe('written_off')
  })

  it('reads every other status exactly like the create path', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'PENDING', '']) {
      expect(mapXeroInvoiceStatusForKnownRow(status, 0, '2026-09-01'))
        .toBe(mapXeroInvoiceStatus(status, 0, '2026-09-01'))
    }
    expect(mapXeroInvoiceStatusForKnownRow(null)).toBeNull()
    expect(mapXeroInvoiceStatusForKnownRow(undefined)).toBeNull()
  })
})

describe('reconcileXeroStatus', () => {
  it('writes the mapped status when it moves the row forward', () => {
    expect(reconcileXeroStatus('draft', 'sent')).toBe('sent')
    expect(reconcileXeroStatus('sent', 'paid')).toBe('paid')
    expect(reconcileXeroStatus('sent', 'written_off')).toBe('written_off')
  })

  it('writes nothing when Xero has no opinion or already agrees', () => {
    expect(reconcileXeroStatus('sent', null)).toBeNull()
    expect(reconcileXeroStatus('paid', 'paid')).toBeNull()
  })

  it('never demotes the local-only refinements of sent', () => {
    // Xero cannot know the client opened the invoice, or that it aged past due.
    expect(reconcileXeroStatus('viewed', 'sent')).toBeNull()
    expect(reconcileXeroStatus('overdue', 'sent')).toBeNull()
    // But it can still settle or void either of them.
    expect(reconcileXeroStatus('overdue', 'paid')).toBe('paid')
    expect(reconcileXeroStatus('viewed', 'written_off')).toBe('written_off')
  })

  it('treats a mapped draft as create-only', () => {
    // A dashboard-raised invoice is pushed to Xero as DRAFT and nothing ever
    // approves it, so Xero says DRAFT for the rest of its life while the local
    // row moves on. Trusting that backwards would hide a live invoice from the
    // client portal, which filters status != 'draft'.
    expect(reconcileXeroStatus('sent', 'draft')).toBeNull()
    expect(reconcileXeroStatus('viewed', 'draft')).toBeNull()
    expect(reconcileXeroStatus('overdue', 'draft')).toBeNull()
    expect(reconcileXeroStatus('paid', 'draft')).toBeNull()
    expect(reconcileXeroStatus('written_off', 'draft')).toBeNull()
    // It may still fill in a row that has no status of its own.
    expect(reconcileXeroStatus(null, 'draft')).toBe('draft')
  })

  it('never undoes a settled or written-off row with a mapped sent', () => {
    // Push-back is not built: a hand mark-paid never reaches Xero, so Xero
    // reporting AUTHORISED on a locally paid invoice means Xero is stale,
    // not that the payment was unwound.
    expect(reconcileXeroStatus('paid', 'sent')).toBeNull()
    expect(reconcileXeroStatus('written_off', 'sent')).toBeNull()
  })

  it('lets the terminal readings through from anywhere', () => {
    expect(reconcileXeroStatus('draft', 'paid')).toBe('paid')
    expect(reconcileXeroStatus('written_off', 'paid')).toBe('paid')
    expect(reconcileXeroStatus('paid', 'written_off')).toBe('written_off')
  })

  it('copes with a row that has no status yet', () => {
    expect(reconcileXeroStatus(null, 'sent')).toBe('sent')
    expect(reconcileXeroStatus(undefined, 'draft')).toBe('draft')
  })
})

describe('shouldUnwindPaidAt', () => {
  it('matches the hand mark-paid rule in the invoice PATCH route', () => {
    expect([...UNWINDS_PAYMENT].sort()).toEqual(['draft', 'overdue', 'sent', 'viewed'])
  })

  it('clears the paid date only when the payment did not happen', () => {
    expect(shouldUnwindPaidAt('paid', 'sent')).toBe(true)
    expect(shouldUnwindPaidAt('paid', 'draft')).toBe(true)
    expect(shouldUnwindPaidAt('paid', 'overdue')).toBe(true)
  })

  it('keeps the paid date on a write-off', () => {
    // On a written-off invoice the money may well have landed, and
    // /financial-reports keys YTD revenue and the tax-year totals off paid_at.
    expect(shouldUnwindPaidAt('paid', 'written_off')).toBe(false)
  })

  it('has nothing to unwind on a row that was never paid', () => {
    expect(shouldUnwindPaidAt('sent', 'draft')).toBe(false)
    expect(shouldUnwindPaidAt(null, 'sent')).toBe(false)
    expect(shouldUnwindPaidAt('paid', null)).toBe(false)
  })
})

describe('resolveXeroStatusWrite', () => {
  const NOW = '2026-09-05T08:00:00.000Z'

  it('writes nothing at all when Xero would only move the row backwards', () => {
    // The live workflow: pushed to Xero as DRAFT, emailed from the dashboard
    // (local 'sent'), paid by bank transfer and hand-marked paid. Xero still
    // says DRAFT because nothing approves it.
    expect(resolveXeroStatusWrite({ status: 'sent', sentAt: NOW }, 'draft', null, NOW)).toEqual({})
    expect(resolveXeroStatusWrite({ status: 'paid', paidAt: '2026-09-02T00:00:00.000Z' }, 'draft', null, NOW)).toEqual({})
  })

  it('promotes a draft and stamps the first send date', () => {
    expect(resolveXeroStatusWrite({ status: 'draft', sentAt: null }, 'sent', null, NOW))
      .toEqual({ status: 'sent', sentAt: NOW })
  })

  it('does not restamp a send date the dashboard already has', () => {
    expect(resolveXeroStatusWrite({ status: 'draft', sentAt: '2026-08-01T00:00:00.000Z' }, 'sent', null, NOW))
      .toEqual({ status: 'sent' })
  })

  it('takes the paid date from Xero rather than from the clock', () => {
    expect(resolveXeroStatusWrite({ status: 'sent' }, 'paid', '2026-09-01', NOW))
      .toEqual({ status: 'paid', paidAt: '2026-09-01T00:00:00.000Z' })
  })

  it('leaves a settled row alone when Xero agrees on the date', () => {
    expect(resolveXeroStatusWrite({ status: 'paid', paidAt: '2026-09-01T00:00:00.000Z' }, 'paid', '2026-09-01', NOW))
      .toEqual({})
  })

  it('repairs a paid row that somehow has no paid date', () => {
    // IC.1 made status 'paid' with a null paid_at an error state.
    expect(resolveXeroStatusWrite({ status: 'paid', paidAt: null }, 'paid', null, NOW))
      .toEqual({ paidAt: NOW })
  })

  it('keeps the paid date when Xero voids a settled invoice', () => {
    expect(resolveXeroStatusWrite({ status: 'paid', paidAt: '2026-09-01T00:00:00.000Z' }, 'written_off', null, NOW))
      .toEqual({ status: 'written_off' })
  })

  it('has nothing to write when Xero has no opinion', () => {
    expect(resolveXeroStatusWrite({ status: 'sent' }, null, null, NOW)).toEqual({})
  })
})

describe('normaliseXeroDate', () => {
  it('converts the .NET epoch shape Xero uses for FullyPaidOnDate', () => {
    expect(normaliseXeroDate('/Date(1518685950940+0000)/')).toBe('2018-02-15T09:12:30.940Z')
    expect(normaliseXeroDate('/Date(1518685950940)/')).toBe('2018-02-15T09:12:30.940Z')
  })

  it('treats a bare date as midnight UTC', () => {
    expect(normaliseXeroDate('2026-09-01')).toBe('2026-09-01T00:00:00.000Z')
  })

  it('treats a zoneless date-time as UTC rather than local time', () => {
    expect(normaliseXeroDate('2026-09-01T13:45:00')).toBe('2026-09-01T13:45:00.000Z')
    expect(normaliseXeroDate('2026-09-01 13:45:00')).toBe('2026-09-01T13:45:00.000Z')
  })

  it('passes an already-zoned stamp through', () => {
    expect(normaliseXeroDate('2026-09-01T13:45:00Z')).toBe('2026-09-01T13:45:00.000Z')
    expect(normaliseXeroDate('2026-09-01T13:45:00+12:00')).toBe('2026-09-01T01:45:00.000Z')
  })

  it('returns null for nothing usable', () => {
    expect(normaliseXeroDate(null)).toBeNull()
    expect(normaliseXeroDate(undefined)).toBeNull()
    expect(normaliseXeroDate('')).toBeNull()
    expect(normaliseXeroDate('   ')).toBeNull()
    expect(normaliseXeroDate('not a date')).toBeNull()
    expect(normaliseXeroDate('/Date(nope)/')).toBeNull()
  })
})
