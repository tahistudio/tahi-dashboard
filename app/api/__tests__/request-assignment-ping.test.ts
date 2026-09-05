/**
 * One hand-over, one ping.
 *
 * Assigning a request writes two rows through two endpoints, in either order.
 * The request detail header PATCHes requests.assigneeId and then mirrors the
 * participant row; the People panel POSTs the participant row and then mirrors
 * the PATCH. Both endpoints used to notify, so every assignee change from
 * either control produced two identical bell entries with the same title, the
 * same "REQ-n" body and the same entity id.
 *
 * The PATCH owns that ping now, because it is the write both paths make. The
 * participants POST keeps its ping for 'pm' and 'follower', which the PATCH
 * knows nothing about.
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

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'user_admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/request-status-effects', () => ({
  emitRequestStatusChanged: vi.fn().mockResolvedValue(undefined),
}))

// The bell sink is mocked; the copy helper next to it stays real, so the
// assertions below pin the words both routes actually send.
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    notifyTeamMember: vi.fn().mockResolvedValue({ delivered: 1, skipped: 0 }),
  }
})

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      _table: 'requests',
      id: 'id',
      orgId: 'org_id',
      title: 'title',
      assigneeId: 'assignee_id',
      requestNumber: 'request_number',
      isInternal: 'is_internal',
      status: 'status',
      updatedAt: 'updated_at',
    },
    requestParticipants: {
      _table: 'request_participants',
      id: 'id',
      requestId: 'request_id',
      participantId: 'participant_id',
      participantType: 'participant_type',
      role: 'role',
      addedAt: 'added_at',
      removedAt: 'removed_at',
    },
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', avatarUrl: 'avatar_url', clerkUserId: 'clerk_user_id' },
    contacts: { _table: 'contacts', id: 'id', name: 'name', email: 'email' },
    tasks: { _table: 'tasks' },
    timeEntries: { _table: 'time_entries' },
    messages: { _table: 'messages' },
    files: { _table: 'files' },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return {
    and: stub, eq: stub, asc: stub, desc: stub, count: stub, gt: stub,
    isNull: stub, inArray: stub,
  }
})

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

import { POST as addParticipant } from '@/app/api/admin/requests/[id]/participants/route'
import { PATCH as patchRequest } from '@/app/api/admin/requests/[id]/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { notifyTeamMember } from '@/lib/notifications'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock
const params = { params: Promise.resolve({ id: 'req_1' }) }

function post(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/requests/req_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The participants POST reads the request, the de-dupe row, then the actor. */
function seedParticipantsPost(): void {
  dbMock.state.queues = {
    requests: [[{ orgId: 'org_client', title: 'Rebuild the checkout', requestNumber: 4 }]],
    request_participants: [[]],
    team_members: [[{ id: 'tm_actor' }]],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
})

describe('POST /api/admin/requests/[id]/participants', () => {
  it('stays quiet on the assignee role, which the PATCH owns', async () => {
    seedParticipantsPost()
    const res = await addParticipant(
      post('/api/admin/requests/req_1/participants', {
        participantId: 'tm_owner',
        participantType: 'team_member',
        role: 'assignee',
      }),
      params,
    )
    expect(res.status).toBe(201)
    expect(notifyTeamMember).not.toHaveBeenCalled()
  })

  it('still tells a new PM, which no PATCH knows about', async () => {
    seedParticipantsPost()
    await addParticipant(
      post('/api/admin/requests/req_1/participants', {
        participantId: 'tm_pm',
        participantType: 'team_member',
        role: 'pm',
      }),
      params,
    )
    expect(notifyTeamMember).toHaveBeenCalledTimes(1)
    const [, memberId, payload] = vi.mocked(notifyTeamMember).mock.calls[0]
    expect(memberId).toBe('tm_pm')
    expect(payload.title).toBe('You are now PM on: "Rebuild the checkout"')
  })

  it('still tells a follower', async () => {
    seedParticipantsPost()
    await addParticipant(
      post('/api/admin/requests/req_1/participants', {
        participantId: 'tm_follower',
        participantType: 'team_member',
        role: 'follower',
      }),
      params,
    )
    expect(notifyTeamMember).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyTeamMember).mock.calls[0][2].title)
      .toBe('You were added to: "Rebuild the checkout"')
  })
})

describe('PATCH /api/admin/requests/[id]', () => {
  it('is the one place a new assignee is told, in the shared words', async () => {
    dbMock.state.queues = {
      requests: [[{
        orgId: 'org_client',
        title: 'Rebuild the checkout',
        assigneeId: 'tm_previous',
        requestNumber: 4,
      }]],
      team_members: [[{ id: 'tm_actor' }]],
    }

    const res = await patchRequest(patch({ assigneeId: 'tm_owner' }), params)
    expect(res.status).toBe(200)
    expect(notifyTeamMember).toHaveBeenCalledTimes(1)
    const [, memberId, payload] = vi.mocked(notifyTeamMember).mock.calls[0]
    expect(memberId).toBe('tm_owner')
    // The same string requestParticipantTitle produces for the bulk assign bar.
    expect(payload.title).toBe('Request assigned to you: "Rebuild the checkout"')
    expect(payload.body).toBe('REQ-4')
  })

  it('does not ping you for assigning yourself', async () => {
    dbMock.state.queues = {
      requests: [[{
        orgId: 'org_client',
        title: 'Rebuild the checkout',
        assigneeId: null,
        requestNumber: 4,
      }]],
      team_members: [[{ id: 'tm_actor' }]],
    }
    await patchRequest(patch({ assigneeId: 'tm_actor' }), params)
    expect(notifyTeamMember).not.toHaveBeenCalled()
  })

  it('does not ping when the assignee did not actually change', async () => {
    dbMock.state.queues = {
      requests: [[{
        orgId: 'org_client',
        title: 'Rebuild the checkout',
        assigneeId: 'tm_owner',
        requestNumber: 4,
      }]],
      team_members: [[{ id: 'tm_actor' }]],
    }
    await patchRequest(patch({ assigneeId: 'tm_owner' }), params)
    expect(notifyTeamMember).not.toHaveBeenCalled()
  })
})
