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

const captured: { runArgs: CapturedSql[] } = { runArgs: [] }

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

vi.mock('@/db/d1', () => ({ schema: {} }))

// Capture the `sql` template. The other named exports (eq/desc/and/ne/inArray)
// are only used by GET, which these tests never call, so leaving them undefined
// is safe.
vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    run: vi.fn((arg: CapturedSql) => {
      captured.runArgs.push(arg)
      return Promise.resolve({ meta: {} })
    }),
  }),
}))

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
 * The size control gates the large option client-side (a client whose plan has
 * no large track cannot pick it) and the category tiles are a fixed set, so a
 * value outside either list arriving here is a probe or a stale client. Size in
 * particular decides how much of the client's capacity the request occupies.
 */
describe('POST /api/portal/requests, submitted vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.runArgs = []
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
