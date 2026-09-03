/**
 * Unit tests for POST /api/portal/requests numbering + auth gates.
 *
 * The key privacy guarantee: a client's request_number is a PER-ORG sequence,
 * so each client sees 1, 2, 3 and never learns the studio's total cross-client
 * request volume. We assert the INSERT scopes its MAX subquery to the caller's
 * org (WHERE org_id = ?), not a global MAX.
 *
 * We mock drizzle-orm's `sql` tag to capture the built statement, mock db/run,
 * and stub events + sanitiser, then call the handler directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedSql {
  strings: string[]
  values: unknown[]
}

/**
 * `selectResults` answers the SELECTs the POST issues, in order. Only the
 * large_task entitlement path reads anything (the active subscription, then
 * the org's tracks override), so every other case leaves this empty and the
 * chain answers with no rows.
 */
const captured: { runArgs: CapturedSql[]; selectResults: unknown[] } = {
  runArgs: [],
  selectResults: [],
}

// ---------------------------------------------------------------------------
// Mocks - hoisted; factories cannot reference outer variables except via the
// module-scoped `captured` object which we read after import.
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/lib/sanitize-rich-text', () => ({
  sanitizeRichText: (s: string) => s,
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    subscriptions: { orgId: 'org_id', status: 'status', planType: 'plan_type', hasPrioritySupport: 'has_priority_support' },
    organisations: { id: 'id', tracksMode: 'tracks_mode', customSmallTracks: 'custom_small_tracks', customLargeTracks: 'custom_large_tracks' },
  },
}))

// Capture the `sql` template. eq/and are called by the entitlement lookup; the
// rest (desc/ne/inArray/notInArray/asc) are only used by GET, which these tests
// never call, so a stub that records nothing is enough.
vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    }),
    eq: stub,
    and: stub,
    ne: stub,
    asc: stub,
    desc: stub,
    inArray: stub,
    notInArray: stub,
  }
})

vi.mock('@/lib/db', () => {
  // A chainable select whose terminal `limit` answers from selectResults.
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'where', 'orderBy', 'offset']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() => Promise.resolve(
    captured.selectResults.length ? captured.selectResults.shift() : [],
  ))
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      run: vi.fn((arg: CapturedSql) => {
        captured.runArgs.push(arg)
        return Promise.resolve({ meta: {} })
      }),
    }),
  }
})

import { POST } from '@/app/api/portal/requests/route'
import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/portal/requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.runArgs = []
    captured.selectResults = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  it('scopes the request_number sequence to the caller org (per-org, not global)', async () => {
    const res = await POST(makeRequest({ title: 'New site section' }))
    expect(res.status).toBe(201)

    expect(captured.runArgs).toHaveLength(1)
    const skeleton = captured.runArgs[0].strings.join('')

    // Per-org: the MAX subquery must filter by org_id.
    expect(skeleton).toContain('MAX(request_number) FROM requests WHERE org_id')
    // Guard against a regression to the old global sequence.
    expect(skeleton).not.toContain('MAX(request_number) FROM requests), 0)')

    // The caller org id is bound as a parameter (org_id column + subquery).
    expect(captured.runArgs[0].values).toContain('org_client')
  })

  it('returns 403 for the Tahi org, unauthenticated callers, and impersonation', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    expect((await POST(makeRequest({ title: 'x' }))).status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ userId: null, orgId: null }))
    expect((await POST(makeRequest({ title: 'x' }))).status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ impersonating: true }))
    expect((await POST(makeRequest({ title: 'x' }))).status).toBe(403)

    expect(captured.runArgs).toHaveLength(0)
  })

  it('returns 400 when the title is missing', async () => {
    const res = await POST(makeRequest({ title: '   ' }))
    expect(res.status).toBe(400)
    expect(captured.runArgs).toHaveLength(0)
  })
})

/**
 * The category tiles are a fixed set, so a value outside the list arriving
 * here is a probe or a stale client. Size gets both halves: the vocabulary
 * check below, and the plan entitlement check in the suite after this one.
 */
describe('POST /api/portal/requests, submitted vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.runArgs = []
    captured.selectResults = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  it('accepts the two sizes and the six categories', async () => {
    for (const type of ['small_task', 'large_task']) {
      const res = await POST(makeRequest({ title: 'x', type }))
      expect(res.status).toBe(201)
    }
    for (const category of ['design', 'development', 'content', 'strategy', 'admin', 'bug']) {
      const res = await POST(makeRequest({ title: 'x', category }))
      expect(res.status).toBe(201)
    }
  })

  it('rejects a size outside the vocabulary before writing', async () => {
    const res = await POST(makeRequest({ title: 'x', type: 'enormous_task' }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toContain('type must be one of')
    expect(captured.runArgs).toHaveLength(0)
  })

  it('rejects a category outside the vocabulary before writing', async () => {
    const res = await POST(makeRequest({ title: 'x', category: 'finance' }))
    expect(res.status).toBe(400)
    expect(captured.runArgs).toHaveLength(0)
  })

  it('rejects form responses that are not JSON', async () => {
    const res = await POST(makeRequest({ title: 'x', formResponses: 'not json at all' }))
    expect(res.status).toBe(400)
    expect(captured.runArgs).toHaveLength(0)
  })

  it('accepts form responses that parse', async () => {
    const res = await POST(makeRequest({ title: 'x', formResponses: '{"q1":"yes"}' }))
    expect(res.status).toBe(201)
    expect(captured.runArgs).toHaveLength(1)
  })
})

/**
 * The size is not cosmetic. /api/portal/capacity reads `type` straight off the
 * row to decide which lane a request occupies, so a client on a plan with no
 * multi-day track could post {"type":"large_task"} and take a large capacity
 * slot their plan does not carry. The dialog gates the option, but only in the
 * browser, which is exactly the half an HTTP client skips.
 */
describe('POST /api/portal/requests, large_task entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.runArgs = []
    captured.selectResults = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  /** subscription row, then the org's tracks override row. */
  function plan(
    sub: { planType: string; hasPrioritySupport: boolean } | null,
    override: { tracksMode: string | null; customSmallTracks: number | null; customLargeTracks: number | null } | null = null,
  ) {
    captured.selectResults = [sub ? [sub] : [], override ? [override] : []]
  }

  it('refuses a large_task from a maintain plan, which has no multi-day track', async () => {
    plan({ planType: 'maintain', hasPrioritySupport: false })
    const res = await POST(makeRequest({ title: 'Full rebuild', type: 'large_task' }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toContain('multi-day track')
    expect(captured.runArgs).toHaveLength(0)
  })

  it('allows a large_task from a scale plan, which carries one', async () => {
    plan({ planType: 'scale', hasPrioritySupport: false })
    const res = await POST(makeRequest({ title: 'Full rebuild', type: 'large_task' }))
    expect(res.status).toBe(201)
    expect(captured.runArgs).toHaveLength(1)
  })

  it('refuses a large_task when a custom override grants zero large tracks', async () => {
    plan(
      { planType: 'scale', hasPrioritySupport: false },
      { tracksMode: 'custom', customSmallTracks: 2, customLargeTracks: 0 },
    )
    const res = await POST(makeRequest({ title: 'Full rebuild', type: 'large_task' }))
    expect(res.status).toBe(400)
    expect(captured.runArgs).toHaveLength(0)
  })

  it('allows a large_task when tracks are off, since there is no lane to overdraw', async () => {
    plan(
      { planType: 'maintain', hasPrioritySupport: false },
      { tracksMode: 'off', customSmallTracks: null, customLargeTracks: null },
    )
    const res = await POST(makeRequest({ title: 'Full rebuild', type: 'large_task' }))
    expect(res.status).toBe(201)
  })

  it('allows a large_task from a client with no active subscription', async () => {
    // A project client has no track model at all, so the size is a hint on the
    // card and refusing it would remove their only large option.
    plan(null)
    const res = await POST(makeRequest({ title: 'Full rebuild', type: 'large_task' }))
    expect(res.status).toBe(201)
  })

  it('never looks a plan up for a small_task', async () => {
    plan({ planType: 'maintain', hasPrioritySupport: false })
    const res = await POST(makeRequest({ title: 'Tweak the footer', type: 'small_task' }))
    expect(res.status).toBe(201)
    // The entitlement lookup is the only SELECT the POST issues, so an
    // untouched queue proves a small request pays nothing for this check.
    expect(captured.selectResults).toHaveLength(2)
  })
})
