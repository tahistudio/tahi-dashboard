/**
 * app/api/__tests__/portal-plan-truth.test.ts
 *
 * What a client is told they pay, and how much capacity they are told they
 * have. Both were wrong for every client on a negotiated rate:
 *
 *   rate      /api/portal/subscription served the CATALOGUE price for the plan
 *             id (NZD 4,000 for scale) and the portal then FX-converted that
 *             fiction into the reader's display currency. The real figure lives
 *             in organisations.custom_mrr / custom_mrr_currency, which are
 *             deliberately absent from db/schema.ts (so SELECT * cannot crash
 *             on a pre-0016 environment) and therefore need a raw read.
 *   capacity  both /api/portal/subscription and /api/portal/tracks counted
 *             PHYSICAL rows in the tracks table. A client configured for one
 *             small plus one large lane, with one row, was told "1 track" and
 *             never saw their large lane at all.
 *
 * Every assertion below is about what the CLIENT is handed, not about how the
 * route gets there. The fake D1 is the recorder from
 * portal-invoice-pay-path.test.ts: only the chain is thenable, and results are
 * served positionally, so the ORDER of the reads each route makes is part of
 * what is pinned here. It gains an `all` handle because the custom rate is read
 * with raw SQL, and a queued Error rejects so the pre-0016 shape can be tested.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: 'org-giant', clerkOrgId: 'clerk_org_giant', impersonating: false,
  }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

import { GET as portalSubscription } from '@/app/api/portal/subscription/route'
import { GET as portalTracks } from '@/app/api/portal/tracks/route'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself (awaiting `db()` must not resolve the query). A queued Error
// rejects, which is how a missing column behaves.
// ---------------------------------------------------------------------------
function makeChain(result: unknown): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(onOk, onErr)
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
    // The custom rate is read with raw SQL, because its columns are not in
    // the Drizzle schema.
    all: () => entry('all'),
  }
  return { handle, entries }
}

function req(url: string) {
  return new NextRequest(`http://localhost:3000${url}`)
}

/** The active retainer row, as both routes select it. */
const SUB_ROW = {
  id: 'sub-giant',
  orgId: 'org-giant',
  planType: 'scale',
  status: 'active',
  billingInterval: 'monthly',
  includedAddons: '[]',
  hasPrioritySupport: false,
  hasSeoAddon: false,
  billingCountry: 'GB',
  currentPeriodStart: '2026-09-01T00:00:00.000Z',
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-01-15T00:00:00.000Z',
}

/** The org row the typed select reads (custom_mrr is NOT in this shape). */
const ORG_CUSTOM_TRACKS = {
  preferredCurrency: 'GBP',
  stripeCustomerId: null,
  tracksMode: 'custom',
  customSmallTracks: 1,
  customLargeTracks: 1,
}

/** Their one physical track row. The large lane has no row yet. */
const SMALL_TRACK_ROW = {
  id: 'track-small-1',
  subscriptionId: 'sub-giant',
  type: 'small',
  isPriorityTrack: false,
  currentRequestId: null,
}

interface SubscriptionBody {
  clientType: string
  subscription: {
    monthlyRate: number
    currency: string
    customRate: boolean
    canManagePayment: boolean
    trackCount: number
  } | null
  billing?: { monthlyRate: number; currency: string; cycleTotal: number }
  plans: Array<{ id: string; monthlyRate: number }>
}

interface TracksBody {
  items: Array<{ id: string; type: string; currentRequest: unknown; queue: unknown[] }>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// GET /api/portal/subscription
// ---------------------------------------------------------------------------
describe('GET /api/portal/subscription plan truth', () => {
  it('serves the negotiated rate in its own currency, and the configured track count', async () => {
    // Reads, in order: settings (plan catalogue), subscription, org, raw
    // custom_mrr, tracks.
    const { handle, entries } = makeDb([
      [],
      [SUB_ROW],
      [ORG_CUSTOM_TRACKS],
      [{ custom_mrr: 2000, custom_mrr_currency: 'GBP' }],
      [SMALL_TRACK_ROW],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalSubscription(req('/api/portal/subscription'))
    expect(res.status).toBe(200)
    const body = await res.json() as SubscriptionBody

    expect(body.subscription).not.toBeNull()
    expect(body.subscription?.monthlyRate).toBe(2000)
    expect(body.subscription?.currency).toBe('GBP')
    expect(body.subscription?.customRate).toBe(true)
    // 1 small + 1 large configured, not the 1 physical row.
    expect(body.subscription?.trackCount).toBe(2)
    // No Stripe customer: nothing for a "manage payment" button to open.
    expect(body.subscription?.canManagePayment).toBe(false)
    // The billing block carries the same currency, so the cycle total cannot
    // be labelled NZD by a consumer.
    expect(body.billing?.currency).toBe('GBP')
    expect(body.billing?.monthlyRate).toBe(2000)
    expect(body.billing?.cycleTotal).toBe(2000)
    // The catalogue is untouched: those are studio list prices in NZD.
    expect(body.plans.find(p => p.id === 'scale')?.monthlyRate).toBe(4000)
    expect(entries).toEqual(['select', 'select', 'select', 'all', 'select'])
  })

  it('falls back to the catalogue rate in NZD when the client has no negotiated rate', async () => {
    const { handle } = makeDb([
      [],
      [SUB_ROW],
      [{ preferredCurrency: 'NZD', stripeCustomerId: 'cus_123', tracksMode: 'auto', customSmallTracks: 0, customLargeTracks: 0 }],
      [{ custom_mrr: null, custom_mrr_currency: null }],
      [SMALL_TRACK_ROW],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalSubscription(req('/api/portal/subscription'))).json() as SubscriptionBody

    expect(body.subscription?.monthlyRate).toBe(4000)
    expect(body.subscription?.currency).toBe('NZD')
    expect(body.subscription?.customRate).toBe(false)
    // preferredCurrency never overrides a list price: the catalogue is NZD.
    expect(body.billing?.currency).toBe('NZD')
    // A Stripe customer does have a portal to open.
    expect(body.subscription?.canManagePayment).toBe(true)
  })

  it('does not 500 when the custom-rate columns do not exist yet', async () => {
    // Pre-migration-0016 shape: the raw read throws rather than returning null.
    const { handle } = makeDb([
      [],
      [SUB_ROW],
      [ORG_CUSTOM_TRACKS],
      new Error('no such column: custom_mrr'),
      [SMALL_TRACK_ROW],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalSubscription(req('/api/portal/subscription'))
    expect(res.status).toBe(200)
    const body = await res.json() as SubscriptionBody

    expect(body.subscription?.monthlyRate).toBe(4000)
    expect(body.subscription?.currency).toBe('NZD')
    expect(body.subscription?.customRate).toBe(false)
    // The tracks override is a different migration (0079) and still resolves.
    expect(body.subscription?.trackCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// GET /api/portal/tracks
// ---------------------------------------------------------------------------
describe('GET /api/portal/tracks lanes', () => {
  it('renders the entitled large lane even with no backing row', async () => {
    // Reads, in order: subscription, tracks, org, requests.
    const { handle } = makeDb([
      [SUB_ROW],
      [SMALL_TRACK_ROW],
      [ORG_CUSTOM_TRACKS],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalTracks(req('/api/portal/tracks'))
    expect(res.status).toBe(200)
    const body = await res.json() as TracksBody

    expect(body.items).toHaveLength(2)
    // buildEffectiveTracks emits large lanes first, then small, so the
    // synthetic lane leads and their real small row follows.
    const synthetic = body.items.find(i => /^synthetic-large-/.test(i.id))
    expect(synthetic).toBeDefined()
    expect(synthetic?.type).toBe('large')
    expect(synthetic?.currentRequest).toBeNull()
    expect(synthetic?.queue).toEqual([])
    expect(body.items.map(i => i.id)).toEqual(['synthetic-large-0', 'track-small-1'])
  })

  it('keeps the real rows when the client runs one unified board', async () => {
    const { handle } = makeDb([
      [SUB_ROW],
      [SMALL_TRACK_ROW],
      [{ preferredCurrency: 'GBP', stripeCustomerId: null, tracksMode: 'off', customSmallTracks: 0, customLargeTracks: 0 }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalTracks(req('/api/portal/tracks'))).json() as TracksBody

    expect(body.items.map(i => i.id)).toEqual(['track-small-1'])
  })
})
