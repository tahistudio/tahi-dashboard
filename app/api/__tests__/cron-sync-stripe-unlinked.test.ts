import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user-admin', orgId: 'org-tahi' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org-tahi',
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/internal-route-access', () => ({ requireStudioAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn().mockReturnValue('sk_test_isolated') }))
vi.mock('@/lib/cron-runs', () => ({
  hasCronSecretAuth: vi.fn().mockReturnValue(false), logCronRun: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/stripe-sync', () => ({ importStripePayments: vi.fn(), importStripeInvoices: vi.fn() }))

import { importStripePayments, importStripeInvoices } from '@/lib/stripe-sync'
import { logCronRun } from '@/lib/cron-runs'
import { POST } from '@/app/api/admin/cron/sync-stripe/route'

const database = {}
const success = { ok: true as const, status: 200, body: { success: true }, count: 0 }
const request = () => new NextRequest('http://localhost/api/admin/cron/sync-stripe', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(importStripePayments).mockResolvedValue(success)
  vi.mocked(importStripeInvoices).mockResolvedValue(success)
})

describe('Stripe cron unlinked customer summaries', () => {
  it('returns and logs customers skipped by both importers, with duplicate money lines collapsed', async () => {
    const paymentLine = 'Stripe customer cus_charge (Charge client) is not linked to a client'
    const invoiceLine = 'No matching org for Stripe customer cus_invoice: Stripe customer cus_invoice (Invoice client)'
    vi.mocked(importStripePayments).mockResolvedValue({
      ...success, count: 1, body: { imported: 1, skipped: 4, results: [
        { chargeId: 'ch-a', status: 'no_client_linked', orgMatch: paymentLine },
        { chargeId: 'ch-b', status: 'no_client_linked', orgMatch: paymentLine },
        { chargeId: 'ch-c', status: 'no_client_linked' },
        { chargeId: 'ch-d', status: 'imported', orgMatch: 'Linked client' },
        { chargeId: 'ch-e', status: 'error', orgMatch: 'Failed to create org' },
      ] },
    })
    vi.mocked(importStripeInvoices).mockResolvedValue({
      ...success, body: { imported: 0, skipped: 2, results: [
        { number: 'STRIPE-A', status: 'no_client_linked', orgMatch: invoiceLine },
        { number: 'STRIPE-B', status: 'no_client_linked', orgMatch: invoiceLine },
      ] },
    })

    const response = await POST(request())
    const summary = { steps: [
      { name: 'import-payments', ok: true, count: 1, unlinked: [paymentLine] },
      { name: 'import-invoices', ok: true, count: 0, unlinked: [invoiceLine] },
    ] }

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(summary)
    expect(logCronRun).toHaveBeenCalledExactlyOnceWith(
      database, 'sync-stripe', 'success', expect.any(Number), summary, null,
    )
    // The cron must leave client creation at each importer's safe default.
    expect(importStripePayments).toHaveBeenCalledExactlyOnceWith(database, 'sk_test_isolated')
    expect(importStripeInvoices).toHaveBeenCalledExactlyOnceWith(database, 'sk_test_isolated')
  })

  it('still logs invoice customers waiting to be linked when the payment step fails', async () => {
    vi.mocked(importStripePayments).mockResolvedValue({
      ok: false, status: 502, body: { error: 'Stripe API error' }, error: 'Stripe API error',
    })
    const line = 'No matching org for Stripe customer cus_waiting: Stripe customer cus_waiting (Waiting client)'
    vi.mocked(importStripeInvoices).mockResolvedValue({
      ...success, body: { imported: 0, skipped: 1, results: [{ status: 'no_client_linked', orgMatch: line }] },
    })

    const response = await POST(request())
    const summary = { steps: [
      { name: 'import-payments', ok: false, error: 'Stripe API error' },
      { name: 'import-invoices', ok: true, count: 0, unlinked: [line] },
    ] }

    await expect(response.json()).resolves.toEqual(summary)
    expect(logCronRun).toHaveBeenCalledExactlyOnceWith(
      database, 'sync-stripe', 'success', expect.any(Number), summary, null,
    )
  })

  it('bounds the persisted customer follow-up list without losing the import count', async () => {
    const lines = Array.from({ length: 55 }, (_, index) => `Stripe customer cus_${index} (Client ${index}) is not linked to a client`)
    vi.mocked(importStripeInvoices).mockResolvedValue({
      ...success, count: 2, body: { imported: 2, skipped: 55, results: lines.map(orgMatch => ({ status: 'no_client_linked', orgMatch })) },
    })

    const response = await POST(request())
    await expect(response.json()).resolves.toMatchObject({ steps: [
      { name: 'import-payments', ok: true, count: 0 },
      { name: 'import-invoices', ok: true, count: 2, unlinked: lines.slice(0, 50) },
    ] })
    expect(vi.mocked(logCronRun).mock.calls[0][4]).toMatchObject({ steps: [
      { name: 'import-payments', ok: true, count: 0 },
      { name: 'import-invoices', ok: true, count: 2, unlinked: lines.slice(0, 50) },
    ] })
  })
})
