/**
 * What a status change tells the client, from both PATCH doors.
 *
 * Two things are pinned here, because both are invisible in the response body
 * and only show up in somebody's inbox:
 *
 *   1. The brand. emitRequestStatusChanged narrows the client fan-out to the
 *      contacts the brand-scoped portal list would show the row to, but only
 *      when the caller actually read requests.brand_id. Neither caller did, so
 *      a contact scoped to brand A was told about brand B's work and handed a
 *      link they would be refused.
 *   2. The email suppression on the bulk door, which is per client rather than
 *      per call. That loop runs once per selected request, so a twenty row
 *      "Mark delivered" for a client with three contacts was sixty sequential
 *      messages to the same three people, against a Resend account that allows
 *      two a second. Suppressing it for every batch cost the other half:
 *      selecting one row and pressing Mark delivered emailed that client
 *      nothing, while the identical move from the detail page did.
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
  // null = unrestricted scope, which is what a super admin resolves to.
  getOrgScope: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/request-status-effects', () => ({
  emitRequestStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitRequestCreated: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return { ...actual, notifyTeamMember: vi.fn().mockResolvedValue({ delivered: 1, skipped: 0 }) }
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
      brandId: 'brand_id',
      status: 'status',
      updatedAt: 'updated_at',
    },
    requestParticipants: { _table: 'request_participants' },
    teamMembers: { _table: 'team_members', id: 'id', clerkUserId: 'clerk_user_id' },
    contacts: { _table: 'contacts', id: 'id' },
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
    isNull: stub, inArray: stub, sql: stub,
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
  const run = vi.fn().mockResolvedValue(undefined)

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update, run }),
    __mock: { state },
  }
})

import { PATCH as patchRequest } from '@/app/api/admin/requests/[id]/route'
import { PATCH as patchBulk } from '@/app/api/admin/requests/bulk/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { emitRequestStatusChanged } from '@/lib/request-status-effects'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock
const params = { params: Promise.resolve({ id: 'req_1' }) }

function patch(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
})

describe('PATCH /api/admin/requests/[id], the client fan-out', () => {
  it('hands the brand on, so the audience matches the portal list', async () => {
    dbMock.state.queues = {
      requests: [
        // The access-scoping read, then the post-update re-read.
        [{ orgId: 'org_client', title: 'New homepage', assigneeId: 'tm_1', requestNumber: 4 }],
        [{
          title: 'New homepage',
          orgId: 'org_client',
          assigneeId: 'tm_1',
          isInternal: false,
          brandId: 'brand_a',
        }],
      ],
    }

    const res = await patchRequest(patch('/api/admin/requests/req_1', { status: 'delivered' }), params)
    expect(res.status).toBe(200)

    expect(emitRequestStatusChanged).toHaveBeenCalledTimes(1)
    const [, subject, status, options] = vi.mocked(emitRequestStatusChanged).mock.calls[0]
    expect(subject.brandId).toBe('brand_a')
    expect(status).toBe('delivered')
    // A single request moving is exactly when the client email is right.
    expect(options?.clientEmail).toBeUndefined()
  })

  it('says "no brand" rather than "brand unread" for a row without one', async () => {
    dbMock.state.queues = {
      requests: [
        [{ orgId: 'org_client', title: 'New homepage', assigneeId: null, requestNumber: 4 }],
        [{ title: 'New homepage', orgId: 'org_client', assigneeId: null, isInternal: false, brandId: null }],
      ],
    }
    await patchRequest(patch('/api/admin/requests/req_1', { status: 'client_review' }), params)
    const [, subject] = vi.mocked(emitRequestStatusChanged).mock.calls[0]
    expect(subject.brandId).toBeNull()
  })
})

describe('PATCH /api/admin/requests/bulk, the client fan-out', () => {
  const rows = [
    { id: 'req_1', orgId: 'org_client', title: 'One', assigneeId: 'tm_1', isInternal: false, brandId: 'brand_a' },
    { id: 'req_2', orgId: 'org_client', title: 'Two', assigneeId: null, isInternal: false, brandId: null },
  ]

  /** id -> the clientEmail option that row was emitted with. */
  function emailByRequest(): Record<string, boolean | undefined> {
    const out: Record<string, boolean | undefined> = {}
    for (const [, subject, , options] of vi.mocked(emitRequestStatusChanged).mock.calls) {
      out[subject.id] = options?.clientEmail
    }
    return out
  }

  it('emits per row, with the brand, and suppresses the client email', async () => {
    // Two reads of the same rows: the scope check, then the re-read after the
    // write that the effects are built from.
    dbMock.state.queues = { requests: [rows, rows] }

    const res = await patchBulk(
      patch('/api/admin/requests/bulk', { ids: ['req_1', 'req_2'], status: 'delivered' }),
    )
    expect(res.status).toBe(200)

    expect(emitRequestStatusChanged).toHaveBeenCalledTimes(2)
    for (const [, , status, options] of vi.mocked(emitRequestStatusChanged).mock.calls) {
      expect(status).toBe('delivered')
      expect(options).toEqual({ clientEmail: false })
    }
    const brands = vi.mocked(emitRequestStatusChanged).mock.calls.map(([, subject]) => subject.brandId)
    expect(brands).toEqual(['brand_a', null])
  })

  it('keeps the email when the batch holds one row for that client', async () => {
    // Selecting a single row and pressing Mark delivered from the bulk bar is
    // the same move as the detail page's, and used to be the silent one.
    const one = [rows[0]]
    dbMock.state.queues = { requests: [one, one] }

    const res = await patchBulk(
      patch('/api/admin/requests/bulk', { ids: ['req_1'], status: 'delivered' }),
    )
    expect(res.status).toBe(200)
    expect(emailByRequest()).toEqual({ req_1: true })
  })

  it('counts per client, not per batch', async () => {
    // One client moving twice is a fan-out to hold back; the other client in
    // the same selection is moving once and should still hear about it.
    const mixed = [
      ...rows,
      { id: 'req_3', orgId: 'org_other', title: 'Three', assigneeId: null, isInternal: false, brandId: null },
    ]
    dbMock.state.queues = { requests: [mixed, mixed] }

    const res = await patchBulk(
      patch('/api/admin/requests/bulk', { ids: ['req_1', 'req_2', 'req_3'], status: 'client_review' }),
    )
    expect(res.status).toBe(200)
    expect(emailByRequest()).toEqual({ req_1: false, req_2: false, req_3: true })
  })

  it('still tells nobody when the batch changes no status', async () => {
    dbMock.state.queues = { requests: [rows, rows] }
    const res = await patchBulk(
      patch('/api/admin/requests/bulk', { ids: ['req_1', 'req_2'], assigneeId: 'tm_9' }),
    )
    expect(res.status).toBe(200)
    expect(emitRequestStatusChanged).not.toHaveBeenCalled()
  })
})
