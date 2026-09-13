/**
 * POST /api/feedback, the beta feedback ball's write route.
 *
 * Identity is resolved server-side: getRequestAuth decides Tahi team vs
 * client, and only a client falls through to getPortalAuth to resolve their
 * D1 org. org_id is always taken from the session, never from the body. A
 * light per-user rate limit (30/hour) is IGNORED rather than errored: the
 * caller still sees a 200, but nothing is written past the limit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  where: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: {
    queues: Record<string, Row[][]>
    inserts: Array<{ table: string; values: Row }>
  }
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  getPortalAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    teamMembers: { _table: 'team_members', clerkUserId: 'clerk_user_id', email: 'email', role: 'role' },
    contacts: { _table: 'contacts', id: 'id', orgId: 'org_id', clerkUserId: 'clerk_user_id', email: 'email' },
    feedbackComments: {
      _table: 'feedback_comments',
      id: 'id',
      orgId: 'org_id',
      userId: 'user_id',
      createdAt: 'created_at',
    },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {}, inserts: [] }

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

  const insert = vi.fn((table: { _table?: string } | undefined) => ({
    values: vi.fn(async (values: Row) => {
      state.inserts.push({ table: table?._table ?? '', values })
    }),
  }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert }),
    __mock: { state },
  }
})

import { POST } from '@/app/api/feedback/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getRequestAuth, getPortalAuth } from '@/lib/server-auth'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

type RequestAuth = Awaited<ReturnType<typeof getRequestAuth>>
type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function requestAuth(overrides: Partial<RequestAuth> = {}): RequestAuth {
  return { userId: 'user_1', orgId: 'org_tahi', sessionId: 's1', ...overrides }
}

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client_d1',
    sessionId: 's2',
    clerkOrgId: 'org_client_clerk',
    impersonating: false,
    ...overrides,
  } as PortalAuth
}

function feedbackRequest(body: Record<string, unknown> | null): NextRequest {
  return new NextRequest('http://localhost:3000/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  dbMock.state.inserts = []
  vi.mocked(getRequestAuth).mockResolvedValue(requestAuth())
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
})

describe('POST /api/feedback - auth', () => {
  it('401s a signed-out caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const res = await POST(feedbackRequest({ body: 'hello' }))
    expect(res.status).toBe(401)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('403s a client session with no resolvable org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue(requestAuth({ orgId: 'org_client_clerk' }))
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: null }))
    const res = await POST(feedbackRequest({ body: 'hello' }))
    expect(res.status).toBe(403)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('POST /api/feedback - validation', () => {
  it('400s a missing body', async () => {
    const res = await POST(feedbackRequest({}))
    expect(res.status).toBe(400)
  })

  it('400s a whitespace-only body', async () => {
    const res = await POST(feedbackRequest({ body: '   ' }))
    expect(res.status).toBe(400)
  })

  it('400s a body over 5000 characters', async () => {
    const res = await POST(feedbackRequest({ body: 'x'.repeat(5001) }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('accepts a body at exactly 5000 characters', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'x'.repeat(5000) }))
    expect(res.status).toBe(201)
  })

  it('400s an unparseable JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/feedback - identity and org scoping', () => {
  it('stores a Tahi admin row with a null org_id, never from the body', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'Looks broken', orgId: 'org_someone_else' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.orgId).toBeNull()
    expect(row.values.userType).toBe('admin')
    expect(row.values.userEmail).toBe('liam@tahi.studio')
    expect(row.values.userId).toBe('user_1')
  })

  it('reads team_member for a non-admin roster row', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'staff@tahi.studio', role: 'member' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'A note' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.userType).toBe('team_member')
  })

  it('defaults to admin for a Tahi session with no roster row yet', async () => {
    dbMock.state.queues = { team_members: [[]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'A note' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.userType).toBe('admin')
    expect(row.values.userEmail).toBeNull()
  })

  it('stores a client contact row scoped to the session org, never the body', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue(requestAuth({ userId: 'user_client', orgId: 'org_client_clerk' }))
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    dbMock.state.queues = { contacts: [[{ email: 'ava@acme.test' }]], feedback_comments: [[]] }

    const res = await POST(feedbackRequest({ body: 'A client comment', orgId: 'org_totally_different' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.orgId).toBe('org_client_d1')
    expect(row.values.userType).toBe('contact')
    expect(row.values.userEmail).toBe('ava@acme.test')
  })
})

describe('POST /api/feedback - context and fields', () => {
  it('stores the gathered page fields and JSON context', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const context = { consoleErrors: [{ level: 'error', message: 'x', timestamp: '2026-01-01T00:00:00.000Z' }], failedFetches: [], headings: ['Overview'], impersonation: null }
    const res = await POST(feedbackRequest({
      body: 'Broken layout',
      route: '/requests/abc',
      pageTitle: 'Requests',
      viewportWidth: 375,
      viewportHeight: 812,
      breakpoint: 'phone',
      theme: 'dark',
      userAgent: 'test-agent',
      context,
    }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.route).toBe('/requests/abc')
    expect(row.values.pageTitle).toBe('Requests')
    expect(row.values.viewportWidth).toBe(375)
    expect(row.values.viewportHeight).toBe(812)
    expect(row.values.breakpoint).toBe('phone')
    expect(row.values.theme).toBe('dark')
    expect(row.values.userAgent).toBe('test-agent')
    expect(JSON.parse(row.values.context as string)).toEqual(context)
  })

  it('rejects a junk breakpoint/theme rather than storing them', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'hi', breakpoint: 'huge', theme: 'rainbow' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.breakpoint).toBeNull()
    expect(row.values.theme).toBeNull()
  })

  it('stores a null context when none is sent', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'hi' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.context).toBeNull()
  })

  it('never throws when context is an odd shape (a bare string, say)', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'hi', context: 'not an object' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(JSON.parse(row.values.context as string)).toBe('not an object')
  })
})

describe('POST /api/feedback - anchor (pick mode)', () => {
  const validAnchor = {
    selector: '#save-btn',
    tag: 'button',
    text: 'Save changes',
    rect: { x: 10, y: 20, width: 100, height: 40, scrollHeight: 2000 },
    context: 'Billing',
  }

  it('stores a valid anchor alongside the comment', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'About this button', anchor: validAnchor }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.anchorSelector).toBe('#save-btn')
    expect(row.values.anchorTag).toBe('button')
    expect(row.values.anchorText).toBe('Save changes')
    expect(row.values.anchorContext).toBe('Billing')
    expect(JSON.parse(row.values.anchorRect as string)).toEqual(validAnchor.rect)
  })

  it('stores nulls for every anchor column when no anchor is sent (a general comment)', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({ body: 'General note' }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.anchorSelector).toBeNull()
    expect(row.values.anchorTag).toBeNull()
    expect(row.values.anchorText).toBeNull()
    expect(row.values.anchorRect).toBeNull()
    expect(row.values.anchorContext).toBeNull()
  })

  it('accepts an anchor with no text or context (both optional)', async () => {
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [[]] }
    const res = await POST(feedbackRequest({
      body: 'About this',
      anchor: { selector: '#x', rect: { x: 0, y: 0, width: 10, height: 10, scrollHeight: 100 } },
    }))
    expect(res.status).toBe(201)
    const row = dbMock.state.inserts.find((i) => i.table === 'feedback_comments')!
    expect(row.values.anchorSelector).toBe('#x')
    expect(row.values.anchorText).toBeNull()
    expect(row.values.anchorContext).toBeNull()
  })

  it('400s an anchor with an oversized selector', async () => {
    const res = await POST(feedbackRequest({
      body: 'hi',
      anchor: { ...validAnchor, selector: 'x'.repeat(601) },
    }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s an anchor with oversized text', async () => {
    const res = await POST(feedbackRequest({
      body: 'hi',
      anchor: { ...validAnchor, text: 'x'.repeat(201) },
    }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s an anchor with oversized context', async () => {
    const res = await POST(feedbackRequest({
      body: 'hi',
      anchor: { ...validAnchor, context: 'x'.repeat(201) },
    }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s an anchor missing a rect field', async () => {
    const res = await POST(feedbackRequest({
      body: 'hi',
      anchor: { ...validAnchor, rect: { x: 0, y: 0, width: 10, height: 10 } },
    }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s an anchor with a non-integer rect field', async () => {
    const res = await POST(feedbackRequest({
      body: 'hi',
      anchor: { ...validAnchor, rect: { x: 0.5, y: 0, width: 10, height: 10, scrollHeight: 100 } },
    }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s an anchor with an empty selector', async () => {
    const res = await POST(feedbackRequest({ body: 'hi', anchor: { ...validAnchor, selector: '   ' } }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('400s a non-object anchor', async () => {
    const res = await POST(feedbackRequest({ body: 'hi', anchor: 'not an object' }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('POST /api/feedback - rate limiting', () => {
  it('ignores (not errors) a request past 30 in the trailing hour', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({ id: `fb_${i}` }))
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [thirty] }
    const res = await POST(feedbackRequest({ body: 'one more' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; stored: boolean }
    expect(json.stored).toBe(false)
    expect(dbMock.state.inserts).toHaveLength(0)
  })

  it('stores normally under the limit', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `fb_${i}` }))
    dbMock.state.queues = { team_members: [[{ email: 'liam@tahi.studio', role: 'admin' }]], feedback_comments: [nine] }
    const res = await POST(feedbackRequest({ body: 'fine' }))
    expect(res.status).toBe(201)
    expect(dbMock.state.inserts).toHaveLength(1)
  })
})
