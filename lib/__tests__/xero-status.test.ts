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
  reconcileXeroStatus,
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

describe('reconcileXeroStatus', () => {
  it('writes the mapped status when it differs', () => {
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

  it('copes with a row that has no status yet', () => {
    expect(reconcileXeroStatus(null, 'sent')).toBe('sent')
    expect(reconcileXeroStatus(undefined, 'draft')).toBe('draft')
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
