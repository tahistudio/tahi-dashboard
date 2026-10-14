// Business fixtures grant the owning feature; real scoped-seat gates are covered by nested-client-scope-sqlite.test.ts.
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
/**
 * Unit test for POST /api/admin/requests/bulk-assign (C1).
 *
 * Bulk assigning the "assignee" role used to write only a participant row, so
 * the "Unassigned" filter (requests.assigneeId IS NULL) and the workload bar
 * (counts assigneeId) never moved. The route now also patches
 * requests.assigneeId for the assignee role. These tests assert that patch
 * lands for assignee, and does NOT fire for pm/follower.
 *
 * Second concern, same route: the bar handed work over and told nobody. The
 * notification tests below pin the fan-out, including the one-entry-per-person
 * rule that keeps a forty row assign from being forty bell rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  requestRows: Row[]
  updates: Array<{ table: string | undefined; patch: Row }>
  inserts: number
  selects: number
} = { requestRows: [], updates: [], inserts: 0, selects: 0 }

// The Slack thread line (CN.3): armed only when the token is set, with the
// queue recorded rather than deferred.
vi.mock('@/lib/slack/work-sync', () => ({
  workSyncArmed: () => !!process.env.SLACK_BOT_TOKEN,
  queueWorkSync: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      _table: 'requests',
      id: 1, orgId: 1, assigneeId: 1, updatedAt: 1, title: 1, requestNumber: 1,
    },
    requestParticipants: {
      _table: 'requestParticipants',
      id: 1, requestId: 1, participantId: 1, participantType: 1, role: 1, removedAt: 1,
    },
    teamMembers: { _table: 'teamMembers', id: 1, clerkUserId: 1 },
    contacts: { _table: 'contacts', id: 1, orgId: 1 },
  },
}))

// The bell sink is mocked; the copy helper next to it stays real so the
// assertions below pin the words the route actually sends.
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    notifyTeamMember: vi.fn().mockResolvedValue({ delivered: 1, skipped: 0 }),
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  inArray: (...a: unknown[]) => ({ op: 'inArray', a }),
  isNull: (...a: unknown[]) => ({ op: 'isNull', a }),
}))

vi.mock('@/lib/db', () => {
  function chainFor(name: string | undefined) {
    const rows = name === 'requests' ? state.requestRows : name === 'contacts' ? [{ orgId: 'org_c' }] : []
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
      select: () => {
        state.selects++
        return { from: (t: { _table?: string } | undefined) => chainFor(t?._table) }
      },
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
import { notifyTeamMember } from '@/lib/notifications'
import { queueWorkSync } from '@/lib/slack/work-sync'

interface BellPayload { type: string; title: string; body?: string | null; entityId?: string | null }
function bellCalls(): Array<{ memberId: string; payload: BellPayload }> {
  return vi.mocked(notifyTeamMember).mock.calls.map(([, memberId, payload]) => ({
    memberId: memberId as string,
    payload: payload as unknown as BellPayload,
  }))
}

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
    state.requestRows = [{ id: 'req1', orgId: 'org_c', title: 'New homepage', requestNumber: 4 }]
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

describe('POST /api/admin/requests/bulk-assign, telling the people', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.requestRows = [{ id: 'req1', orgId: 'org_c', title: 'New homepage', requestNumber: 4 }]
    state.updates = []
    state.inserts = 0
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  it('names the request when one row was assigned', async () => {
    await POST(makePost({
      requestIds: ['req1'],
      participants: [{ participantId: 'tm1', participantType: 'team_member', role: 'assignee' }],
    }))

    const calls = bellCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].memberId).toBe('tm1')
    expect(calls[0].payload.title).toBe('Request assigned to you: "New homepage"')
    expect(calls[0].payload.body).toBe('REQ-4')
    expect(calls[0].payload.entityId).toBe('req1')
    // Its own event, not the task toggle it used to borrow.
    expect(calls[0].payload.type).toBe('request_assigned')
  })

  it('collapses a multi row assign into one entry per person', async () => {
    state.requestRows = [
      { id: 'req1', orgId: 'org_c', title: 'New homepage', requestNumber: 4 },
      { id: 'req2', orgId: 'org_c', title: 'Pricing page', requestNumber: 5 },
      { id: 'req3', orgId: 'org_c', title: 'Blog index', requestNumber: 6 },
    ]

    await POST(makePost({
      requestIds: ['req1', 'req2', 'req3'],
      participants: [{ participantId: 'tm1', participantType: 'team_member', role: 'follower' }],
    }))

    const calls = bellCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].payload.title).toBe('You were added to 3 requests')
    // A list rather than a deep link, because there is no single row to open.
    expect(calls[0].payload.entityId).toBeNull()
  })

  it('never tells a contact about studio staffing', async () => {
    await POST(makePost({
      requestIds: ['req1'],
      participants: [{ participantId: 'ct1', participantType: 'contact', role: 'follower' }],
    }))
    expect(bellCalls()).toHaveLength(0)
  })
})

describe('POST /api/admin/requests/bulk-assign, the Slack thread line (CN.3)', () => {
  const assignTm1 = {
    requestIds: ['req1', 'req2'],
    participants: [{ participantId: 'tm1', participantType: 'team_member', role: 'assignee' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    state.requestRows = [
      { id: 'req1', orgId: 'org_c', title: 'New homepage', requestNumber: 4, assigneeId: 'tm2' },
      { id: 'req2', orgId: 'org_c', title: 'Pricing page', requestNumber: 5, assigneeId: 'tm1' },
    ]
    state.updates = []
    state.inserts = 0
    state.selects = 0
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('queues nothing and reads nothing extra while Slack is not configured', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    await POST(makePost(assignTm1))
    const unarmedSelects = state.selects
    expect(queueWorkSync).not.toHaveBeenCalled()

    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    state.selects = 0
    await POST(makePost(assignTm1))
    // The before-state rides the request read the route already makes.
    expect(state.selects).toBe(unarmedSelects)
  })

  it('queues one batch, holding only the requests whose owner moved', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    await POST(makePost(assignTm1))
    expect(queueWorkSync).toHaveBeenCalledTimes(1)
    expect(vi.mocked(queueWorkSync).mock.calls[0][1]).toEqual([{
      entityType: 'request',
      entityId: 'req1',
      actor: { type: 'studio', clerkUserId: 'admin' },
      changes: [{ field: 'assignee', from: 'tm2', to: 'tm1' }],
    }])
  })

  it('queues nothing for a pm or follower, or a contact, which move no owner', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    await POST(makePost({
      requestIds: ['req1'],
      participants: [
        { participantId: 'tm3', participantType: 'team_member', role: 'pm' },
        { participantId: 'tm4', participantType: 'team_member', role: 'follower' },
        { participantId: 'ct1', participantType: 'contact', role: 'follower' },
      ],
    }))
    expect(queueWorkSync).not.toHaveBeenCalled()
  })
})
