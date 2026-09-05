/**
 * POST /api/portal/requests tells the studio.
 *
 * The route used to end at dispatchDomainEvent and return, so a client filing
 * work in the product we are asking them to move to reached nobody: the only
 * signal was a Triage badge on a board someone had to open. A request emailed
 * in was louder, because the email intake webhook already called
 * notifyAllAdmins.
 *
 * These tests drive the real route over the same fake-D1 harness the numbering
 * suite uses, with the notification sink mocked and the email plan builder
 * real, so the bell copy and the [REQ-n] subject prefix are both pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedSql {
  strings: string[]
  values: unknown[]
}

const captured: { runArgs: CapturedSql[]; selectResults: unknown[] } = {
  runArgs: [],
  selectResults: [],
}

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/sanitize-rich-text', () => ({
  sanitizeRichText: (s: string) => s,
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications', () => ({
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    subscriptions: { orgId: 'org_id', status: 'status', planType: 'plan_type', hasPrioritySupport: 'has_priority_support' },
    organisations: { id: 'id', name: 'name', tracksMode: 'tracks_mode', customSmallTracks: 'custom_small_tracks', customLargeTracks: 'custom_large_tracks' },
    requests: { id: 'id', orgId: 'org_id', requestNumber: 'request_number', isInternal: 'is_internal', status: 'status', createdAt: 'created_at', queueOrder: 'queue_order' },
    contacts: { id: 'id', name: 'name', clerkUserId: 'clerk_user_id' },
  },
}))

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
import { notifyAllAdmins } from '@/lib/notifications'

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

/** The three reads the route makes after the insert, in order. */
function afterInsert(requestNumber: number | null, orgName: string | null, submitter: string | null) {
  captured.selectResults = [
    requestNumber === null ? [] : [{ requestNumber }],
    orgName === null ? [] : [{ name: orgName }],
    submitter === null ? [] : [{ name: submitter }],
  ]
}

interface StudioPayload {
  type: string
  title: string
  body?: string | null
  entityType?: string | null
  entityId?: string | null
  email?: { subject: string }
}

function studioPayload(): StudioPayload {
  const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
  return payload as unknown as StudioPayload
}

describe('POST /api/portal/requests, telling the studio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.runArgs = []
    captured.selectResults = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  it('fans a request_created event out to every Tahi admin', async () => {
    afterInsert(7, 'Acme Ltd', 'Jo Yarnall')

    const res = await POST(makeRequest({ title: 'Fix the footer' }))
    expect(res.status).toBe(201)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)

    const payload = studioPayload()
    expect(payload.type).toBe('request_created')
    expect(payload.entityType).toBe('request')
    expect(typeof payload.entityId).toBe('string')
  })

  it('puts the per-org request number in the title, with the client in the body', async () => {
    afterInsert(7, 'Acme Ltd', 'Jo Yarnall')
    await POST(makeRequest({ title: 'Fix the footer' }))

    const payload = studioPayload()
    expect(payload.title).toBe('New request REQ-7: Fix the footer')
    // REQ-7 is a per-org sequence, so the client name has to travel with it.
    expect(payload.body).toBe('From Acme Ltd, Jo Yarnall')
  })

  it('prefixes the email subject with the same reference', async () => {
    afterInsert(7, 'Acme Ltd', 'Jo Yarnall')
    await POST(makeRequest({ title: 'Fix the footer' }))

    expect(studioPayload().email?.subject).toBe('[REQ-7] New request from Acme Ltd: Fix the footer')
  })

  it('degrades to a bare title and subject for a row with no number yet', async () => {
    afterInsert(null, 'Acme Ltd', null)
    await POST(makeRequest({ title: 'Fix the footer' }))

    const payload = studioPayload()
    expect(payload.title).toBe('New request: Fix the footer')
    expect(payload.body).toBe('From Acme Ltd')
    expect(payload.email?.subject).toBe('New request from Acme Ltd: Fix the footer')
  })

  it('tells nobody when the submission is refused', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ impersonating: true }))
    expect((await POST(makeRequest({ title: 'Fix the footer' }))).status).toBe(403)

    const res = await POST(makeRequest({ title: '   ' }))
    expect(res.status).toBe(400)

    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(captured.runArgs).toHaveLength(0)
  })
})
