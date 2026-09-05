/**
 * Ship readiness Tier 1 item 13: a client message or review verdict reaches the
 * team even when the request is unassigned.
 *
 * Both portal routes used to notify `requests.assigneeId` and nobody else, so
 * everything a client said between submission and triage landed in silence.
 * They now go through notifyRequestTeam, which fans out to the assignee, the
 * request's team participants and the client's PM, and falls back to the whole
 * studio when none of those resolve.
 *
 * These tests drive the real resolver over the fake-D1 harness used elsewhere in
 * this folder, with only the notification sinks mocked, so the queries and the
 * escalation rule are both covered.
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
  state: { queues: Record<string, Row[][]> }
}

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sanitize-rich-text', () => ({
  sanitizeRichText: (s: string) => s,
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      _table: 'requests',
      id: 'id',
      orgId: 'org_id',
      isInternal: 'is_internal',
      assigneeId: 'assignee_id',
      title: 'title',
      requestNumber: 'request_number',
      status: 'status',
      updatedAt: 'updated_at',
      deliveredAt: 'delivered_at',
    },
    contacts: { _table: 'contacts', id: 'id', name: 'name', email: 'email', clerkUserId: 'clerk_user_id' },
    messages: { _table: 'messages' },
    requestParticipants: {
      _table: 'request_participants',
      requestId: 'request_id',
      participantId: 'participant_id',
      participantType: 'participant_type',
      removedAt: 'removed_at',
    },
    teamMemberAccess: {
      _table: 'team_member_access',
      id: 'id',
      teamMemberId: 'team_member_id',
      role: 'role',
    },
    teamMemberAccessOrgs: {
      _table: 'team_member_access_orgs',
      accessId: 'access_id',
      orgId: 'org_id',
    },
    teamMembers: { _table: 'team_members', id: 'id' },
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

  const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }))
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update }),
    __mock: { state },
  }
})

// Import after mocks are set up
import { POST as postMessage } from '@/app/api/portal/requests/[id]/messages/route'
import { POST as postReview } from '@/app/api/portal/requests/[id]/review/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'
import { createNotifications, notifyAllAdmins } from '@/lib/notifications'

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

function messageRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/req_1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function reviewRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/req_1/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'req_1' }) }

/** Every teamMembers.id createNotifications was handed, flattened. */
function notifiedMemberIds(): string[] {
  const mock = vi.mocked(createNotifications)
  return mock.mock.calls.flatMap(([, recipients]) =>
    (recipients as Array<{ teamMemberId?: string }>).map(r => r.teamMemberId ?? ''),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  vi.mocked(createNotifications).mockResolvedValue({ delivered: 0, skipped: 0 })
})

// ---------------------------------------------------------------------------
// Client message
// ---------------------------------------------------------------------------

describe('POST /api/portal/requests/[id]/messages - studio fan-out', () => {
  it('notifies the assignee, every team participant and the org PM', async () => {
    vi.mocked(createNotifications).mockResolvedValue({ delivered: 3, skipped: 0 })
    dbMock.state.queues = {
      requests: [
        // One read: ownership check and notification subject in the same row.
        [{ id: 'req_1', orgId: 'org_client', assigneeId: 'tm_assignee', title: 'New homepage', requestNumber: 4 }],
      ],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[
        { participantId: 'tm_follower', participantType: 'team_member' },
        { participantId: 'ct_1', participantType: 'contact' },
      ]],
      team_member_access: [[{ pmId: 'tm_pm' }]],
    }

    const res = await postMessage(messageRequest({ body: 'Any progress?' }), params)
    expect(res.status).toBe(201)

    const ids = notifiedMemberIds()
    expect(ids).toContain('tm_assignee')
    expect(ids).toContain('tm_follower')
    expect(ids).toContain('tm_pm')
    // The client's own people on the thread must not be told about their message.
    expect(ids).not.toContain('ct_1')
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('falls back to the whole studio when the request is unassigned', async () => {
    dbMock.state.queues = {
      requests: [
        [{ id: 'req_1', orgId: 'org_client', assigneeId: null, title: 'Just submitted', requestNumber: 1 }],
      ],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[]],
      team_member_access: [[]],
    }

    const res = await postMessage(messageRequest({ body: 'First message' }), params)
    expect(res.status).toBe(201)
    expect(createNotifications).not.toHaveBeenCalled()
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect(payload.entityType).toBe('request')
    expect(payload.entityId).toBe('req_1')
    expect(payload.type).toBe('new_message')
  })

  it('escalates to the studio when every named recipient has no linked login', async () => {
    // 1 recipient resolved, 1 skipped => nobody heard it, so escalate.
    vi.mocked(createNotifications).mockResolvedValue({ delivered: 0, skipped: 1 })
    dbMock.state.queues = {
      requests: [
        [{ id: 'req_1', orgId: 'org_client', assigneeId: 'tm_never_signed_in', title: 'Orphaned', requestNumber: 2 }],
      ],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[]],
      team_member_access: [[]],
    }

    await postMessage(messageRequest({ body: 'Hello?' }), params)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
  })

  it('does not escalate when a resolved recipient simply muted the channel', async () => {
    // 1 recipient, 0 skipped, 0 delivered => a deliberate mute, not silence.
    vi.mocked(createNotifications).mockResolvedValue({ delivered: 0, skipped: 0 })
    dbMock.state.queues = {
      requests: [
        [{ id: 'req_1', orgId: 'org_client', assigneeId: 'tm_muted', title: 'Muted', requestNumber: 3 }],
      ],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[]],
      team_member_access: [[]],
    }

    await postMessage(messageRequest({ body: 'Hello?' }), params)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('still refuses a request outside the caller org', async () => {
    dbMock.state.queues = { requests: [[]] }
    const res = await postMessage(messageRequest({ body: 'Sneaky' }), params)
    expect(res.status).toBe(404)
    expect(createNotifications).not.toHaveBeenCalled()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Review verdict
// ---------------------------------------------------------------------------

describe('POST /api/portal/requests/[id]/review - studio fan-out', () => {
  const reviewable = {
    id: 'req_1',
    orgId: 'org_client',
    title: 'New homepage',
    status: 'client_review',
    assigneeId: 'tm_assignee',
  }

  it('notifies the assignee, participants and the PM on a verdict', async () => {
    vi.mocked(createNotifications).mockResolvedValue({ delivered: 2, skipped: 0 })
    dbMock.state.queues = {
      requests: [[reviewable]],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[{ participantId: 'tm_pm_participant', participantType: 'team_member' }]],
      team_member_access: [[{ pmId: 'tm_pm' }]],
    }

    const res = await postReview(reviewRequest({ decision: 'approve' }), params)
    expect(res.status).toBe(200)

    const ids = notifiedMemberIds()
    expect(ids).toContain('tm_assignee')
    expect(ids).toContain('tm_pm_participant')
    expect(ids).toContain('tm_pm')
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('falls back to the studio when the request has no assignee, PM or participants', async () => {
    dbMock.state.queues = {
      requests: [[{ ...reviewable, assigneeId: null }]],
      contacts: [[{ id: 'ct_1' }]],
      request_participants: [[]],
      team_member_access: [[]],
    }

    const res = await postReview(reviewRequest({ decision: 'changes', note: 'Smaller hero please' }), params)
    expect(res.status).toBe(200)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect(payload.type).toBe('request_status_changed')
    expect(payload.entityId).toBe('req_1')
  })

  it('does not notify anyone when the request is not in client review', async () => {
    dbMock.state.queues = {
      requests: [[{ ...reviewable, status: 'in_progress' }]],
    }
    const res = await postReview(reviewRequest({ decision: 'approve' }), params)
    expect(res.status).toBe(400)
    expect(createNotifications).not.toHaveBeenCalled()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })
})
