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
    contacts: { id: 'id', name: 'name', orgId: 'org_id', clerkUserId: 'clerk_user_id' },
    brandContacts: { contactId: 'contact_id', brandId: 'brand_id', createdAt: 'created_at' },
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

/**
 * Every read the route makes, in order: the submitter's contact row and their
 * brand links before the insert (which decide requests.brand_id), then the
 * request number and the org name the studio notification needs after it.
 *
 * The submitter's name rides on the first read: the row is read once and used
 * for both halves, where it used to be fetched again after the insert.
 */
function seedReads(
  requestNumber: number | null,
  orgName: string | null,
  submitter: string | null,
  brands: string[] = [],
) {
  captured.selectResults = [
    [{ id: 'ct_1', name: submitter }],
    brands.map((brandId) => ({ brandId })),
    requestNumber === null ? [] : [{ requestNumber }],
    orgName === null ? [] : [{ name: orgName }],
  ]
}

/**
 * The brand bound into the INSERT. Not every column is a bound value (status,
 * is_internal and the request_number subquery are literal), so this reads the
 * one position that matters: id, org_id, brand_id are the first three.
 */
function insertedBrandId(): unknown {
  return captured.runArgs[0].values[2]
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
    seedReads(7, 'Acme Ltd', 'Jo Yarnall')

    const res = await POST(makeRequest({ title: 'Fix the footer' }))
    expect(res.status).toBe(201)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)

    const payload = studioPayload()
    expect(payload.type).toBe('request_created')
    expect(payload.entityType).toBe('request')
    expect(typeof payload.entityId).toBe('string')
  })

  it('puts the per-org request number in the title, with the client in the body', async () => {
    seedReads(7, 'Acme Ltd', 'Jo Yarnall')
    await POST(makeRequest({ title: 'Fix the footer' }))

    const payload = studioPayload()
    expect(payload.title).toBe('New request REQ-7: Fix the footer')
    // REQ-7 is a per-org sequence, so the client name has to travel with it.
    expect(payload.body).toBe('From Acme Ltd, Jo Yarnall')
  })

  it('prefixes the email subject with the same reference', async () => {
    seedReads(7, 'Acme Ltd', 'Jo Yarnall')
    await POST(makeRequest({ title: 'Fix the footer' }))

    expect(studioPayload().email?.subject).toBe('[REQ-7] New request from Acme Ltd: Fix the footer')
  })

  it('degrades to a bare title and subject for a row with no number yet', async () => {
    seedReads(null, 'Acme Ltd', null)
    await POST(makeRequest({ title: 'Fix the footer' }))

    const payload = studioPayload()
    expect(payload.title).toBe('New request: Fix the footer')
    expect(payload.body).toBe('From Acme Ltd')
    expect(payload.email?.subject).toBe('New request from Acme Ltd: Fix the footer')
  })

  it("files the request under the submitter's brand when they have exactly one", async () => {
    seedReads(7, 'Acme Ltd', 'Jo Yarnall', ['brand_a'])
    await POST(makeRequest({ title: 'Fix the footer' }))

    expect(captured.runArgs[0].strings.join('')).toContain('brand_id')
    // Without this the portal hid the row from the person who filed it: the
    // client list only shows a brand-linked contact their own brands.
    expect(insertedBrandId()).toBe('brand_a')
  })

  it('files a multi-brand submitter under their first link, never under none', async () => {
    seedReads(8, 'Acme Ltd', 'Jo Yarnall', ['brand_a', 'brand_b'])
    await POST(makeRequest({ title: 'Fix the header' }))
    // A null brand is not "everyone can see it": SQL IN never matches NULL, so
    // the portal list and the client email audience would both drop the person
    // who filed it. The first link is a brand they hold, so both keep them.
    expect(insertedBrandId()).toBe('brand_a')
  })

  it('honours a brand the client names, when it is one of their own links', async () => {
    seedReads(9, 'Acme Ltd', 'Jo Yarnall', ['brand_a', 'brand_b'])
    await POST(makeRequest({ title: 'Fix the header', brandId: 'brand_b' }))
    expect(insertedBrandId()).toBe('brand_b')
  })

  it('ignores a brand the submitter does not hold', async () => {
    seedReads(10, 'Acme Ltd', 'Jo Yarnall', ['brand_a'])
    await POST(makeRequest({ title: 'Fix the header', brandId: 'brand_of_another_client' }))
    // An id on the body is a hint, never an authority: it cannot stamp another
    // client's brand onto this row.
    expect(insertedBrandId()).toBe('brand_a')
  })

  it('leaves the brand off only when the submitter holds no links at all', async () => {
    seedReads(11, 'Acme Ltd', 'Jo Yarnall', [])
    await POST(makeRequest({ title: 'Fix the footer' }))
    // Nobody at the org is brand scoped for this row, and the notification
    // audience drops brand-linked contacts for exactly the same reason, so the
    // list and the inbox still agree.
    expect(insertedBrandId()).toBeNull()
  })

  it('files the request anyway when the submitter has no contact row here', async () => {
    captured.selectResults = [[], [{ requestNumber: 12 }], [{ name: 'Acme Ltd' }]]
    const res = await POST(makeRequest({ title: 'Fix the footer' }))

    expect(res.status).toBe(201)
    expect(insertedBrandId()).toBeNull()
    // The brand and the submitter's name are both worth less than the request.
    expect(studioPayload().body).toBe('From Acme Ltd')
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
