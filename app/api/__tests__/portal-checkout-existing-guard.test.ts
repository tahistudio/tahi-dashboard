/**
 * app/api/__tests__/portal-checkout-existing-guard.test.ts
 *
 * POST /api/portal/checkout must refuse a client the studio already bills.
 *
 * The UI half of this (buildSteps in components/tahi/onboarding-content.tsx no
 * longer routing an existing client through plan + pay) is the first line of
 * defence, and it is not the one that matters when something goes wrong. A
 * stale tab, a bookmarked /onboarding link or a hand-rolled POST all reach this
 * route directly, and a single success there creates a REAL, recurring Stripe
 * subscription for a client already invoiced through Xero. So the refusal is
 * pinned here, at the handler, on two independent signals:
 *
 *   an active subscription row   they are on a retainer with us already.
 *   the Xero rail                the studio invoices them directly, so a Stripe
 *                                subscription bills them twice on a rail nobody
 *                                reconciles. Resolved exactly as the portal
 *                                invoice routes resolve it: the org's own
 *                                invoice_channel first, then the studio default
 *                                from settings.
 *
 * Both refusals are asserted to happen BEFORE getStripe() is called, because
 * "returns 409" and "never touched Stripe" are different guarantees and only
 * the second one is worth anything on a money path.
 *
 * The third case is the one that stops the guard being a blanket refusal: a
 * clean new-client org, no subscription and no Xero rail, must still fall
 * through to the Stripe-not-configured 503. If that case ever starts returning
 * 409, self-serve signup is dead and this test says so.
 *
 * Fake D1 is the positional recorder from portal-invoice-pay-path.test.ts: only
 * the chain is thenable, and results are served in the order the route reads
 * them, so the ORDER of the guard's three reads is part of what is pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: 'org-a', clerkOrgId: 'clerk_org_a', impersonating: false,
  }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn().mockResolvedValue(true) }))

// Only getStripe is faked. STRIPE_PLANS / isPlanId / isPresentmentCurrency stay
// real so the body validation this route does before the guard is the real one.
vi.mock('@/lib/stripe-plans', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/stripe-plans')>()
  return { ...actual, getStripe: vi.fn(() => null) }
})

import { db } from '@/lib/db'
import { getStripe } from '@/lib/stripe-plans'
import { NextRequest } from 'next/server'
import { INVOICE_CHANNEL_SETTING_KEY } from '@/lib/invoice-channel'

import { POST as portalCheckout } from '@/app/api/portal/checkout/route'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself (awaiting `db()` must not resolve the query).
// ---------------------------------------------------------------------------
function makeChain(result: unknown): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return () => proxy
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const entries: string[] = []
  const queue = [...results]
  const entry = (method: string) => {
    entries.push(method)
    return makeChain(queue.length ? queue.shift() : [])
  }
  const handle = {
    select: () => entry('select'),
    insert: () => entry('insert'),
    update: () => entry('update'),
    delete: () => entry('delete'),
  }
  return { handle, entries }
}

function checkoutReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/portal/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The guard's three reads, in the order the route makes them. */
function guardReads(input: {
  activeSubs?: unknown[]
  orgChannel?: string | null
  studioDefault?: string
}) {
  return [
    input.activeSubs ?? [],
    [{ invoiceChannel: input.orgChannel ?? null }],
    input.studioDefault === undefined
      ? []
      : [{ key: INVOICE_CHANNEL_SETTING_KEY, value: input.studioDefault }],
  ]
}

const BODY = { plan: 'scale', addon: false, currency: 'gbp' }

describe('POST /api/portal/checkout refuses a client the studio already bills', () => {
  beforeEach(() => {
    vi.mocked(getStripe).mockClear()
    vi.mocked(getStripe).mockReturnValue(null)
  })

  it('409s when the org already holds an active subscription, without touching Stripe', async () => {
    const { handle, entries } = makeDb(guardReads({ activeSubs: [{ id: 'sub-row-1' }] }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq(BODY))
    const json = (await res.json()) as { error?: string }

    expect(res.status).toBe(409)
    expect(json.error).toContain('already has an active retainer')
    // The whole point: no Stripe client was ever constructed, so no
    // subscription, customer or invoice could have been created.
    expect(getStripe).not.toHaveBeenCalled()
    // No write reached D1 either.
    expect(entries).not.toContain('insert')
    expect(entries).not.toContain('update')
  })

  it('409s for a Xero-rail org with no subscription at all, without touching Stripe', async () => {
    // Giant Group's real shape at the time this guard was written: no
    // subscription row, invoice_channel set to the Xero rail.
    const { handle, entries } = makeDb(guardReads({ activeSubs: [], orgChannel: 'xero' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq(BODY))
    const json = (await res.json()) as { error?: string }

    expect(res.status).toBe(409)
    expect(json.error).toContain('invoiced directly by the studio')
    expect(getStripe).not.toHaveBeenCalled()
    expect(entries).not.toContain('insert')
    expect(entries).not.toContain('update')
  })

  it('409s when the org has no channel of its own but the studio default is Xero', async () => {
    // organisations.invoice_channel is NULL for most clients, so the studio
    // default is what actually decides the rail. resolveInvoiceChannel is the
    // same resolution the portal invoice routes use.
    const { handle } = makeDb(guardReads({ orgChannel: null, studioDefault: 'xero' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq(BODY))

    expect(res.status).toBe(409)
    expect(getStripe).not.toHaveBeenCalled()
  })

  it('lets a clean new-client org through to the Stripe-not-configured 503', async () => {
    // The over-refusal canary. No subscription, no org channel, studio default
    // is Stripe: this org is exactly who self-serve checkout is for, and the
    // guard must be invisible to them.
    const { handle } = makeDb(guardReads({ activeSubs: [], orgChannel: null, studioDefault: 'stripe' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq(BODY))
    const json = (await res.json()) as { error?: string }

    expect(res.status).toBe(503)
    expect(json.error).toBe('Stripe is not configured')
    // It got as far as asking for a Stripe client, which is how we know the
    // guard let it past rather than short-circuiting on some other read.
    expect(getStripe).toHaveBeenCalled()
  })

  it('does not refuse an org whose only subscription is an abandoned incomplete checkout', async () => {
    // The guard filters on status='active' in SQL, so an 'incomplete' row never
    // comes back from that read. Pinned as an empty result rather than a row,
    // because the filter is the behaviour: a client retrying their first
    // payment, or switching presentment currency, must still get through.
    const { handle } = makeDb(guardReads({ activeSubs: [], orgChannel: null, studioDefault: 'stripe' }))
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq(BODY))

    expect(res.status).toBe(503)
  })

  it('still 400s an invalid plan before it reads anything', async () => {
    const { handle, entries } = makeDb([])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalCheckout(checkoutReq({ plan: 'enterprise' }))

    expect(res.status).toBe(400)
    expect(entries).toHaveLength(0)
    expect(getStripe).not.toHaveBeenCalled()
  })
})
