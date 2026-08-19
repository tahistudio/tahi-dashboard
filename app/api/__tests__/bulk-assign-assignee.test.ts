/**
 * Unit test for POST /api/admin/requests/bulk-assign (C1).
 *
 * Bulk assigning the "assignee" role used to write only a participant row, so
 * the "Unassigned" filter (requests.assigneeId IS NULL) and the workload bar
 * (counts assigneeId) never moved. The route now also patches
 * requests.assigneeId for the assignee role. These tests assert that patch
 * lands for assignee, and does NOT fire for pm/follower.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  requestRows: Row[]
  updates: Array<{ table: string | undefined; patch: Row }>
  inserts: number
} = { requestRows: [], updates: [], inserts: 0 }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { _table: 'requests', id: 1, orgId: 1, assigneeId: 1, updatedAt: 1 },
    requestParticipants: {
      _table: 'requestParticipants',
      id: 1, requestId: 1, participantId: 1, participantType: 1, role: 1, removedAt: 1,
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
  isNull: (...a: unknown[]) => ({ op: 'isNull', a }),
}))

vi.mock('@/lib/db', () => {
  function chainFor(name: string | undefined) {
    const rows = name === 'requests' ? state.requestRows : []
    const chain = Promise.resolve(rows) as Promise<Row[]> & {
      where: () => typeof chain
      limit: () => typeof chain
    }
    chain.where = () => chain
    chain.limit = () => chain
    return chain
  }
  return {
    db: vi.fn().mockResolvedValue({
      select: () => ({ from: (t: { _table?: string } | undefined) => chainFor(t?._table) }),
      update: (t: { _table?: string } | undefined) => ({
        set: (patch: Row) => {
          state.updates.push({ table: t?._table, patch })
          return { where: () => Promise.resolve(undefined) }
        },
      }),
      insert: () => ({ values: () => { state.inserts++; return Promise.resolve(undefined) } }),
    }),
  }
})

import { POST } from '@/app/api/admin/requests/bulk-assign/route'
import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/requests/bulk-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/requests/bulk-assign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.requestRows = [{ id: 'req1', orgId: 'org_c' }]
    state.updates = []
    state.inserts = 0
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  it('patches requests.assigneeId when assigning the assignee role', async () => {
    const res = await POST(makePost({
      requestIds: ['req1'],
      participants: [{ participantId: 'tm1', participantType: 'team_member', role: 'assignee' }],
    }))
    expect(res.status).toBe(200)

    const requestUpdates = state.updates.filter(u => u.table === 'requests')
    expect(requestUpdates).toHaveLength(1)
    expect(requestUpdates[0].patch.assigneeId).toBe('tm1')
    // Still writes the participant row too.
    expect(state.inserts).toBe(1)
  })

  it('does NOT patch requests.assigneeId for the follower role', async () => {
    const res = await POST(makePost({
      requestIds: ['req1'],
      participants: [{ participantId: 'c1', participantType: 'contact', role: 'follower' }],
    }))
    expect(res.status).toBe(200)
    expect(state.updates.filter(u => u.table === 'requests')).toHaveLength(0)
  })
})
