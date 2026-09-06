/**
 * POST /api/admin/invoices/dedupe-manyrequests-twins: the gates, the default
 * and the audit row.
 *
 * Deleting finance rows is a destructive door, so the apply carries the
 * super-admin gate on top of the billing feature gate, and the endpoint
 * defaults to a dry run. The pairing, carry and refusal logic itself is pinned
 * in lib/__tests__/manyrequests-invoice-twins.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn().mockResolvedValue({ isSuperAdmin: true }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/manyrequests-dedupe', () => ({
  planManyrequestsTwinDedupe: vi.fn().mockResolvedValue({
    dryRun: true,
    pairs: [],
    refused: [],
    removedInvoiceIds: [],
    applied: { invoicesDeleted: 0, itemsMoved: 0, itemsDeleted: 0, numbersCarried: 0, keysCarried: 0 },
  }),
}))

import { POST } from '@/app/api/admin/invoices/dedupe-manyrequests-twins/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { planManyrequestsTwinDedupe } from '@/lib/manyrequests-dedupe'

type Access = Awaited<ReturnType<typeof resolvePermissions>>
type Plan = Awaited<ReturnType<typeof planManyrequestsTwinDedupe>>

const emptyPlan = {
  dryRun: false,
  pairs: [],
  refused: [],
  removedInvoiceIds: [],
  applied: { invoicesDeleted: 0, itemsMoved: 0, itemsDeleted: 0, numbersCarried: 0, keysCarried: 0 },
} as unknown as Plan

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/invoices/dedupe-manyrequests-twins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/invoices/dedupe-manyrequests-twins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Access)
    vi.mocked(planManyrequestsTwinDedupe).mockResolvedValue(emptyPlan)
  })

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(403)
    expect(planManyrequestsTwinDedupe).not.toHaveBeenCalled()
  })

  it('honours the billing feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(403)
    expect(requireFeature).toHaveBeenCalledWith(expect.anything(), 'billing')
    expect(planManyrequestsTwinDedupe).not.toHaveBeenCalled()
  })

  it('defaults to a dry run', async () => {
    await POST(makeRequest({}))
    expect(vi.mocked(planManyrequestsTwinDedupe).mock.calls[0][1]).toEqual({ dryRun: true })
  })

  it('lets a non-super-admin run the read-only dry run', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Access)
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(200)
  })

  it('refuses the apply to an admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Access)
    const res = await POST(makeRequest({ dryRun: false }))
    expect(res.status).toBe(403)
    expect(planManyrequestsTwinDedupe).not.toHaveBeenCalled()
  })

  it('writes one audit row naming every pair, every id removed and what was carried', async () => {
    vi.mocked(planManyrequestsTwinDedupe).mockResolvedValue({
      dryRun: false,
      pairs: [{
        orgId: 'org_1',
        orgName: 'Physitrack',
        manyrequests: {
          invoiceId: 'inv_mr', source: 'manyrequests', status: 'paid', manyrequestsId: 'INV-2025000008',
          stripeInvoiceId: null, xeroInvoiceId: null, number: 'INV-2025000008', amount: 3125,
          currency: 'GBP', createdAt: null, paidAt: null, itemCount: 2,
        },
        ledger: {
          invoiceId: 'inv_xero', source: 'xero', status: 'paid', manyrequestsId: null,
          stripeInvoiceId: null, xeroInvoiceId: 'xero_abc', number: null, amount: 3125,
          currency: 'GBP', createdAt: null, paidAt: null, itemCount: 0,
        },
        carry: { manyrequestsId: 'INV-2025000008', number: 'INV-2025000008', itemsMoved: 2, itemsDeleted: 0 },
        distanceDays: 1,
      }],
      refused: [],
      removedInvoiceIds: ['inv_mr'],
      applied: { invoicesDeleted: 1, itemsMoved: 2, itemsDeleted: 0, numbersCarried: 1, keysCarried: 1 },
    } as unknown as Plan)

    await POST(makeRequest({ dryRun: false }))
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('manyrequests_invoice_twin_dedupe')
    expect(entry.metadata?.removedInvoiceIds).toEqual(['inv_mr'])
    const pairs = entry.metadata?.pairs as Array<Record<string, unknown>>
    expect(pairs[0]).toMatchObject({
      removedInvoiceId: 'inv_mr',
      keptInvoiceId: 'inv_xero',
      keptXeroInvoiceId: 'xero_abc',
      carried: { manyrequestsId: 'INV-2025000008', number: 'INV-2025000008', itemsMoved: 2, itemsDeleted: 0 },
    })
  })

  it('writes no audit row when nothing was removed', async () => {
    await POST(makeRequest({ dryRun: false }))
    expect(logAudit).not.toHaveBeenCalled()
  })
})
