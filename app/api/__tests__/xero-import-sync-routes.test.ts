/**
 * The two admin doors onto the Xero readers:
 *
 *   POST /api/admin/integrations/xero/import-invoices
 *   POST /api/admin/integrations/xero/sync-payments
 *
 * Both are thin: the reconciliation itself lives in lib/xero-sync.ts (tested
 * in lib/__tests__/xero-sync.test.ts against the same fake D1) so the daily
 * orchestrator cron can reuse it without an HTTP self-call. What is worth
 * pinning here is the wiring: these routes now WRITE to invoices they have
 * already seen rather than skipping them, so the admin gate and the feature
 * gate in front of them matter more than they did, and the import page number
 * has to reach the reader.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/xero-sync', () => ({
  importXeroInvoices: vi.fn(),
  syncXeroPayments: vi.fn(),
}))

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { importXeroInvoices, syncXeroPayments } from '@/lib/xero-sync'

import { POST as importInvoices } from '@/app/api/admin/integrations/xero/import-invoices/route'
import { POST as syncPayments } from '@/app/api/admin/integrations/xero/sync-payments/route'

function req(url: string) {
  return new NextRequest(`http://localhost:3000${url}`, { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(importXeroInvoices).mockResolvedValue({
    ok: true, status: 200, body: { success: true, imported: 1, updated: 2, skipped: 0 }, count: 3,
  })
  vi.mocked(syncXeroPayments).mockResolvedValue({
    ok: true, status: 200, body: { success: true, updated: 2, pagesRead: 3 }, count: 2,
  })
})

describe('POST /api/admin/integrations/xero/import-invoices', () => {
  it('passes the requested page through and returns the reader outcome', async () => {
    const res = await importInvoices(req('/api/admin/integrations/xero/import-invoices?page=3'))

    expect(vi.mocked(importXeroInvoices).mock.calls[0][1]).toBe(3)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imported: 1, updated: 2 })
  })

  it('defaults to page 1', async () => {
    await importInvoices(req('/api/admin/integrations/xero/import-invoices'))
    expect(vi.mocked(importXeroInvoices).mock.calls[0][1]).toBe(1)
  })

  it('refuses a client org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org-a' } as never)

    const res = await importInvoices(req('/api/admin/integrations/xero/import-invoices'))

    expect(res.status).toBe(403)
    expect(importXeroInvoices).not.toHaveBeenCalled()
  })

  it('honours the integrations feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as never,
    )

    const res = await importInvoices(req('/api/admin/integrations/xero/import-invoices'))

    expect(res.status).toBe(403)
    expect(importXeroInvoices).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/integrations/xero/sync-payments', () => {
  it('reports how many Xero pages were read', async () => {
    const res = await syncPayments(req('/api/admin/integrations/xero/sync-payments'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ updated: 2, pagesRead: 3 })
  })

  it('surfaces a Xero failure at its own status', async () => {
    vi.mocked(syncXeroPayments).mockResolvedValue({
      ok: false, status: 500, body: { error: 'Failed to fetch invoices from Xero' }, error: 'Failed to fetch invoices from Xero',
    })

    const res = await syncPayments(req('/api/admin/integrations/xero/sync-payments'))

    expect(res.status).toBe(500)
  })

  it('refuses a client org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org-a' } as never)

    const res = await syncPayments(req('/api/admin/integrations/xero/sync-payments'))

    expect(res.status).toBe(403)
    expect(syncXeroPayments).not.toHaveBeenCalled()
  })

  it('honours the integrations feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as never,
    )

    const res = await syncPayments(req('/api/admin/integrations/xero/sync-payments'))

    expect(res.status).toBe(403)
    expect(syncXeroPayments).not.toHaveBeenCalled()
  })
})
