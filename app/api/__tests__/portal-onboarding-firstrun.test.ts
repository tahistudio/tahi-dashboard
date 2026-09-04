/**
 * Ship readiness Tier 1 item 19: the first-run checklist must not greet an
 * established client as a brand new one.
 *
 * GET /api/portal/onboarding used to return organisations.onboardingState raw.
 * Nothing except the panel's own PATCH ever writes that blob, and every import
 * path (lib/stripe-import.ts, lib/stripe-sync.ts, lib/xero-sync.ts) seeds it
 * '{}', so at cutover a migrated client would land on "Kia ora, welcome to your
 * studio. Four small steps" with 0/4 done. The route now derives the two
 * knowable steps and says whether this org is a first run at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  where: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: { queues: Record<string, Row[][]> }
}

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: {
      _table: 'organisations',
      id: 'id',
      onboardingState: 'onboarding_state',
      onboardingLoomUrl: 'onboarding_loom_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    requests: { _table: 'requests', orgId: 'org_id', status: 'status' },
    subscriptions: { _table: 'subscriptions', orgId: 'org_id', status: 'status' },
    invoices: { _table: 'invoices', orgId: 'org_id', status: 'status' },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {} }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.where = () => chain
    chain.limit = () => chain
    return chain
  }

  const select = vi.fn(() => ({
    from: (table: { _table?: string } | undefined) => {
      const queue = state.queues[table?._table ?? ''] ?? []
      return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
    },
  }))

  return {
    db: vi.fn().mockResolvedValue({ select }),
    __mock: { state },
  }
})

import { GET } from '@/app/api/portal/onboarding/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  } as PortalAuth
}

function req(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/onboarding')
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

interface SeedOptions {
  onboardingState?: string | null
  createdAt?: string
  requests?: Row[]
  subscriptions?: Row[]
  invoices?: Row[]
}

function seed(options: SeedOptions = {}) {
  dbMock.state.queues = {
    organisations: [[{
      onboardingState: options.onboardingState ?? '{}',
      onboardingLoomUrl: null,
      createdAt: options.createdAt ?? daysAgo(1),
    }]],
    requests: [options.requests ?? []],
    subscriptions: [options.subscriptions ?? []],
    invoices: [options.invoices ?? []],
  }
}

interface OnboardingBody {
  onboardingState: Record<string, boolean>
  onboardingLoomUrl: string | null
  firstRunEligible: boolean
}

async function body(): Promise<OnboardingBody> {
  const res = await GET(req())
  return (await res.json()) as OnboardingBody
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
})

describe('GET /api/portal/onboarding - gates', () => {
  it('403s a session with no org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: null }))
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('403s the Tahi admin org', async () => {
    const prev = process.env.NEXT_PUBLIC_TAHI_ORG_ID
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi' }))
    try {
      const res = await GET(req())
      expect(res.status).toBe(403)
    } finally {
      process.env.NEXT_PUBLIC_TAHI_ORG_ID = prev
    }
  })
})

describe('GET /api/portal/onboarding - derived state', () => {
  it('lets a genuinely new org see the panel', async () => {
    seed()
    const json = await body()
    expect(json.firstRunEligible).toBe(true)
    expect(json.onboardingState.firstRequestSubmitted).toBeUndefined()
  })

  it('ticks the request step off a real request', async () => {
    seed({ requests: [{ status: 'submitted' }] })
    const json = await body()
    expect(json.onboardingState.firstRequestSubmitted).toBe(true)
  })

  it('ticks the billing step off an active subscription', async () => {
    seed({ subscriptions: [{ status: 'active' }] })
    expect((await body()).onboardingState.billingSetUp).toBe(true)
  })

  it('ticks the billing step off a paid invoice', async () => {
    seed({ invoices: [{ status: 'paid' }] })
    expect((await body()).onboardingState.billingSetUp).toBe(true)
  })

  it('does not tick billing for a draft invoice or a cancelled plan', async () => {
    seed({ invoices: [{ status: 'draft' }], subscriptions: [{ status: 'cancelled' }] })
    expect((await body()).onboardingState.billingSetUp).toBeUndefined()
  })

  it('refuses the panel to a migrated client with an empty blob', async () => {
    seed({
      onboardingState: '{}',
      createdAt: daysAgo(400),
      requests: [{ status: 'delivered' }],
      subscriptions: [{ status: 'active' }],
    })
    const json = await body()
    expect(json.firstRunEligible).toBe(false)
    expect(json.onboardingState.firstRequestSubmitted).toBe(true)
    expect(json.onboardingState.billingSetUp).toBe(true)
  })

  it('refuses the panel once work has been delivered, however young the org', async () => {
    seed({ createdAt: daysAgo(2), requests: [{ status: 'delivered' }] })
    expect((await body()).firstRunEligible).toBe(false)
  })

  it('survives a corrupt onboardingState blob', async () => {
    seed({ onboardingState: 'not json' })
    const json = await body()
    expect(json.firstRunEligible).toBe(true)
    expect(json.onboardingState).toEqual({})
  })

  it('404s an org that is not there', async () => {
    dbMock.state.queues = { organisations: [[]] }
    const res = await GET(req())
    expect(res.status).toBe(404)
  })
})
