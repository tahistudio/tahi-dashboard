/**
 * Unit tests for GET /api/portal/requests/[id] - the client-safe projection.
 *
 * The bare drizzle.select() used to hand a paying client the whole requests
 * row, including internal routing/scope columns. The route now projects an
 * explicit allow-list. We assert (a) the internal columns are ABSENT from the
 * response (absence, not blanking), and (b) message authors resolve to a real
 * name with a server-computed own-message flag.
 *
 * The db mock is projection-aware: select(projection).from(table) returns the
 * queued source rows reduced to the projection's keys, exactly like drizzle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: { queues: Record<string, Row[][]> } = { queues: {} }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ notifyTeamMember: vi.fn() }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn() }))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { _table: 'requests', id: 1, orgId: 1, isInternal: 1 },
    contacts: { _table: 'contacts', id: 1, name: 1, clerkUserId: 1 },
    organisations: { _table: 'organisations', id: 1, name: 1 },
    messages: { _table: 'messages', id: 1, authorId: 1, authorType: 1 },
    teamMembers: { _table: 'teamMembers', id: 1, name: 1 },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (...args: unknown[]) => ({ op: 'asc', args }),
}))

type Chain = Promise<Row[]> & {
  leftJoin: () => Chain
  where: () => Chain
  orderBy: () => Chain
  limit: () => Chain
}

vi.mock('@/lib/db', () => {
  function chainFor(tableName: string | undefined, projection: Record<string, unknown> | undefined): Chain {
    const resultSets = state.queues[tableName ?? ''] ?? []
    const rows = resultSets.length > 0 ? (resultSets.shift() as Row[]) : []
    const projected = projection
      ? rows.map(r => Object.fromEntries(Object.keys(projection).map(k => [k, r[k]])))
      : rows
    const chain = Promise.resolve(projected) as Chain
    chain.leftJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }
  const select = (projection?: Record<string, unknown>) => ({
    from: (table: { _table?: string } | undefined) => chainFor(table?._table, projection),
  })
  return { db: vi.fn().mockResolvedValue({ select }) }
})

import { GET } from '@/app/api/portal/requests/[id]/route'
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

function makeGet(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/r1', { method: 'GET' })
}
const ctx = { params: Promise.resolve({ id: 'r1' }) }

// A source row that carries every internal column the projection must drop.
const REQUEST_SOURCE: Row = {
  id: 'r1', orgId: 'org_client', type: 'small_task', category: 'design', title: 'Homepage',
  description: '<p>x</p>', status: 'client_review', priority: 'standard', estimatedHours: 3,
  startDate: null, dueDate: null, revisionCount: 0, maxRevisions: 3, requestNumber: 1,
  size: 'small', parentRequestId: null, createdAt: 't', updatedAt: 't', deliveredAt: null,
  // internal-only columns:
  scopeFlagged: true, scopeFlagReason: 'over budget', isInternal: false, assigneeId: 'tm1',
  checklists: '[{"title":"x"}]', tags: '["vip"]', queueOrder: 5, scheduleRowId: 'sch1',
}

describe('GET /api/portal/requests/[id] projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    state.queues = {}
  })

  it('omits internal columns from the request payload (absence, not blanking)', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[]],
    }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as { request: Row }

    // Client-safe fields survive.
    expect(json.request.id).toBe('r1')
    expect(json.request.title).toBe('Homepage')
    expect(json.request.status).toBe('client_review')

    // Internal columns must not be present at all.
    for (const leaked of [
      'scopeFlagged', 'scopeFlagReason', 'isInternal', 'assigneeId',
      'checklists', 'tags', 'queueOrder', 'scheduleRowId',
    ]) {
      expect(json.request).not.toHaveProperty(leaked)
    }
  })

  it('labels messages by author and flags the client\'s own messages', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[
        { id: 'm1', authorId: 'contact_self', authorType: 'contact', body: 'hi', isInternal: false, editedAt: null, createdAt: 't1', teamMemberName: null, contactName: 'Sam' },
        { id: 'm2', authorId: 'tm1', authorType: 'team_member', body: 'hello', isInternal: false, editedAt: null, createdAt: 't2', teamMemberName: 'Ana', contactName: null },
      ]],
    }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as {
      messages: Array<{ id: string; isOwn: boolean; authorName: string | null; teamMemberName: string | null }>
    }

    const own = json.messages.find(m => m.id === 'm1')!
    expect(own.isOwn).toBe(true)
    expect(own.authorName).toBe('Sam (Acme)')

    const team = json.messages.find(m => m.id === 'm2')!
    expect(team.isOwn).toBe(false)
    expect(team.authorName).toBeNull()
    expect(team.teamMemberName).toBe('Ana')
  })

  it('returns 404 when the request does not resolve under the caller org', async () => {
    state.queues = { requests: [[]] }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 403 for the Tahi admin org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(403)
  })
})
