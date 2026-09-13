/**
 * GET /api/portal/team - the client home "Your team" card.
 *
 * Giant Group (2026-09-13): the client had a PM assigned through
 * POST /api/admin/clients/[id]/pm but no visible requests yet, so the old
 * request-derived-only query found nobody and the card read "Your team is
 * being assigned. They will show up here soon." even though Liam had been
 * assigned as their project manager days earlier.
 *
 * The route now reads the org's assigned PM directly off team_member_access
 * / team_member_access_orgs (the same join /api/admin/clients/[id]/pm
 * writes and reads) and puts them first, ahead of anyone derived from the
 * org's requests, with no duplicate when the PM also happens to be a
 * request assignee or participant. When there is truly nobody (no PM, no
 * request activity) it falls back to the studio's configured default
 * owner (settings key leads.defaultLeadOwnerId) before giving up.
 *
 * The db mock mirrors app/api/__tests__/portal-calls-attendee-guard.test.ts:
 * queues are keyed by table name, not by call order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  leftJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: {
    queues: Record<string, Row[][]>
  }
}

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    teamMemberAccess: { _table: 'team_member_access', id: 'id', teamMemberId: 'team_member_id', role: 'role' },
    teamMemberAccessOrgs: { _table: 'team_member_access_orgs', accessId: 'access_id', orgId: 'org_id' },
    teamMembers: {
      _table: 'team_members',
      id: 'id', name: 'name', title: 'title', department: 'department',
      avatarUrl: 'avatar_url', clerkUserId: 'clerk_user_id',
    },
    requests: { _table: 'requests', id: 'id', orgId: 'org_id', isInternal: 'is_internal', assigneeId: 'assignee_id' },
    requestParticipants: {
      _table: 'request_participants', requestId: 'request_id', participantId: 'participant_id',
      participantType: 'participant_type', role: 'role', removedAt: 'removed_at',
    },
    settings: { _table: 'settings', key: 'key', value: 'value' },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {} }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.innerJoin = () => chain
    chain.leftJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
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

// Import after mocks are set up
import { GET } from '@/app/api/portal/team/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_giant_group',
    sessionId: 'sess_1',
    clerkOrgId: 'org_giant_group',
    impersonating: false,
    ...overrides,
  } as PortalAuth
}

function teamRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/team')
}

interface TeamItem {
  id: string
  name: string
  role: string
  avatarUrl: string | null
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
})

describe('GET /api/portal/team', () => {
  it('PM only: an assigned PM with zero requests still shows up, first', async () => {
    dbMock.state.queues = {
      team_member_access: [[{ id: 'tm-liam', name: 'Liam Miller', title: null, department: null, avatarUrl: null }]],
      requests: [[]],
    }

    const res = await GET(teamRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: TeamItem[] }
    expect(json.items).toHaveLength(1)
    expect(json.items[0]).toEqual({ id: 'tm-liam', name: 'Liam Miller', role: 'Your project manager', avatarUrl: null })
  })

  it('PM plus request assignees: the PM sorts first and is never duplicated', async () => {
    dbMock.state.queues = {
      team_member_access: [[{ id: 'tm-liam', name: 'Liam Miller', title: null, department: null, avatarUrl: null }]],
      // req-1 goes to a different team member; req-2 happens to also be
      // directly assigned to the PM, which must not produce a second row.
      requests: [[
        { id: 'req-1', assigneeId: 'tm-alex' },
        { id: 'req-2', assigneeId: 'tm-liam' },
      ]],
      request_participants: [[
        { participantId: 'tm-alex', role: 'assignee' },
      ]],
      team_members: [[
        { id: 'tm-alex', name: 'Alex Assignee', title: 'Designer', department: null, avatarUrl: null },
      ]],
    }

    const res = await GET(teamRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: TeamItem[] }
    expect(json.items).toHaveLength(2)
    expect(json.items[0]).toEqual({ id: 'tm-liam', name: 'Liam Miller', role: 'Your project manager', avatarUrl: null })
    expect(json.items[1]).toEqual({ id: 'tm-alex', name: 'Alex Assignee', role: 'Designer', avatarUrl: null })
    // The PM must not also appear in the request-derived roster.
    expect(json.items.filter((i) => i.id === 'tm-liam')).toHaveLength(1)
  })

  it('nobody: no PM, no request activity, no default owner configured, honest empty', async () => {
    dbMock.state.queues = {
      team_member_access: [[]],
      requests: [[]],
      settings: [[]],
    }

    const res = await GET(teamRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: TeamItem[] }
    expect(json.items).toEqual([])
  })

  it('falls back to the studio default owner when nobody is assigned', async () => {
    dbMock.state.queues = {
      team_member_access: [[]],
      requests: [[]],
      settings: [[{ value: 'tm-staci' }]],
      team_members: [[{ id: 'tm-staci', name: 'Staci Bonnie', avatarUrl: null }]],
    }

    const res = await GET(teamRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: TeamItem[] }
    expect(json.items).toHaveLength(1)
    expect(json.items[0]).toEqual({ id: 'tm-staci', name: 'Staci Bonnie', role: 'Your project manager', avatarUrl: null })
  })
})
