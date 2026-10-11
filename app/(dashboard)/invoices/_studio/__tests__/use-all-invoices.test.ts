import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/swr-fetcher'
import { loadAllInvoices, MAX_INVOICE_PAGES, type InvoicePage } from '../use-all-invoices'
import type { StudioInvoice } from '../invoice-views'

const rows = (start: number, count: number): StudioInvoice[] => Array.from({ length: count }, (_, n) => ({
  id: `inv-${start + n}`, orgId: 'org', orgName: 'Client', status: 'sent', source: 'manual', totalAmount: 100, currency: 'NZD',
  dueDate: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
}))
const response = (page: number, items: StudioInvoice[]): InvoicePage => ({ page, limit: 50, items })
describe('complete invoice ledger reads', () => {
  it('uses the real SWR HTTP fetcher and preserves a later-page error body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(response(1, rows(0, 50)))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    try {
      expect(await loadAllInvoices()).toMatchObject({ items: [], complete: false, error: { status: 403, info: { error: 'Forbidden' } } })
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/api/admin/invoices?status=all&page=1', '/api/admin/invoices?status=all&page=2'])
    } finally { fetchSpy.mockRestore() }
  })
  it('reads all pages and stops at the first short page', async () => {
    const read = vi.fn().mockResolvedValueOnce(response(1, rows(0, 50))).mockResolvedValueOnce(response(2, rows(50, 2)))
    const ledger = await loadAllInvoices(read)
    expect(ledger).toMatchObject({ complete: true, scopeNone: false, capped: false, error: null })
    expect(ledger.items).toHaveLength(52)
    expect(read.mock.calls).toEqual([['/api/admin/invoices?status=all&page=1'], ['/api/admin/invoices?status=all&page=2']])
  })
  it('requires an empty terminal page for exact multiples of 50', async () => {
    const read = vi.fn().mockResolvedValueOnce(response(1, rows(0, 50))).mockResolvedValueOnce(response(2, []))
    expect((await loadAllInvoices(read)).complete).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('withholds completeness at the actual 40-page cap even when every page succeeded', async () => {
    const read = vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'http://test').searchParams.get('page'))
      return response(page, rows((page - 1) * 50, 50))
    })
    expect(await loadAllInvoices(read)).toMatchObject({ complete: false, capped: true, error: null })
    expect(read).toHaveBeenCalledTimes(MAX_INVOICE_PAGES)
  })
  it('keeps loaded rows explicitly incomplete after a later-page failure', async () => {
    const failure = new ApiError(500)
    const read = vi.fn().mockResolvedValueOnce(response(1, rows(0, 50))).mockRejectedValueOnce(failure)
    const ledger = await loadAllInvoices(read)
    expect(ledger.items).toHaveLength(50)
    expect(ledger).toMatchObject({ complete: false, capped: false, error: failure })
  })
  it('removes prior-page data on a later-page 403', async () => {
    const read = vi.fn().mockResolvedValueOnce(response(1, rows(0, 50))).mockRejectedValueOnce(new ApiError(403))
    expect(await loadAllInvoices(read)).toMatchObject({ items: [], complete: false, error: { status: 403 } })
  })
  it('distinguishes no client scope from a genuinely empty ledger', async () => {
    const read = vi.fn().mockResolvedValue({ ...response(1, []), scope: 'none' })
    expect(await loadAllInvoices(read)).toMatchObject({ items: [], complete: true, scopeNone: true })
    expect(await loadAllInvoices(async () => response(1, []))).toMatchObject({ items: [], complete: true, scopeNone: false })
  })
  it('detects overlapping IDs instead of silently deduplicating a moving ledger into a false total', async () => {
    const read = vi.fn().mockResolvedValueOnce(response(1, rows(0, 50))).mockResolvedValueOnce(response(2, rows(49, 2)))
    const ledger = await loadAllInvoices(read)
    expect(ledger.complete).toBe(false)
    expect(ledger.error?.message).toContain('changed while paging')
  })
  it.each([
    { page: 2, limit: 50, items: [] }, { page: 1, limit: 0, items: [] },
    { page: 1, limit: 50 }, { page: 1, limit: 50, items: rows(0, 51) },
  ])('refuses a malformed page %o', async page => {
    expect(await loadAllInvoices(vi.fn().mockResolvedValue(page))).toMatchObject({ complete: false, error: expect.any(Error) })
  })
  it('refreshes every page after import or recovery, including a newly added page', async () => {
    let imported = false
    const read = vi.fn(async (path: string) => {
      const page = Number(new URL(path, 'http://test').searchParams.get('page'))
      return response(page, imported ? rows((page - 1) * 50, page < 3 ? 50 : 1) : rows(0, 1))
    })
    expect((await loadAllInvoices(read)).items).toHaveLength(1)
    imported = true
    read.mockClear()
    expect((await loadAllInvoices(read)).items).toHaveLength(101)
    expect(read.mock.calls.map(([url]) => url)).toEqual([1, 2, 3].map(page => `/api/admin/invoices?status=all&page=${page}`))
  })
})
