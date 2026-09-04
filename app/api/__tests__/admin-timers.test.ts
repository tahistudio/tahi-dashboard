/**
 * Route tests for the live timer (Tier 1 item 12).
 *
 * Two ways hours used to disappear:
 *   1. A task timer persisted orgId null, so stopping it had no client to
 *      file the time entry against. The entry was skipped, the timer row was
 *      deleted anyway, and the UI toasted success over the loss.
 *   2. Switching timers passed the NEW target's org in as a hint for the OLD
 *      timer, filing client A's hours against client B.
 *
 * The org now comes off the timer's own request or task row, and a stop that
 * cannot log says logged:false with a reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  rows: Record<string, Row[]>
  inserts: Array<{ table: string | undefined; values: Row }>
  deletes: Array<string | undefined>
} = { rows: {}, inserts: [], deletes: [] }

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'clerk_admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/internal-org', () => ({
  INTERNAL_ORG_ID: 'org_tahi_internal',
  ensureInternalOrg: vi.fn().mockResolvedValue('org_tahi_internal'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    activeTimers: { _table: 'activeTimers', id: 1, userId: 1, requestId: 1, taskId: 1, orgId: 1 },
    requests: { _table: 'requests', id: 1, orgId: 1, title: 1, requestNumber: 1 },
    tasks: { _table: 'tasks', id: 1, orgId: 1, requestId: 1, title: 1, type: 1 },
    organisations: { _table: 'organisations', id: 1, name: 1 },
    teamMembers: { _table: 'teamMembers', id: 1, clerkUserId: 1 },
    timeEntries: { _table: 'timeEntries' },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
}))

vi.mock('@/lib/db', () => {
  function chainFor(name: string | undefined) {
    const rows = state.rows[name ?? ''] ?? []
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
      insert: (t: { _table?: string } | undefined) => ({
        values: (values: Row) => {
          state.inserts.push({ table: t?._table, values })
          return Promise.resolve(undefined)
        },
      }),
      delete: (t: { _table?: string } | undefined) => ({
        where: () => {
          state.deletes.push(t?._table)
          return Promise.resolve(undefined)
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    }),
  }
})

import { POST } from '@/app/api/admin/timers/route'
import { DELETE } from '@/app/api/admin/timers/[id]/route'
import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/timers${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(id: string, action = 'log'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/timers/${id}?action=${action}`, { method: 'DELETE' })
}

function timerRow(over: Row): Row {
  return {
    id: 'timer_old',
    userId: 'clerk_admin',
    requestId: null,
    taskId: null,
    orgId: null,
    startedAt: '2026-09-01T09:00:00.000Z',
    pausedAt: null,
    pausedSeconds: 0,
    lastPingAt: '2026-09-01T09:30:00.000Z',
    notes: null,
    ...over,
  }
}

function startedTimer(): Row {
  const insert = state.inserts.find(i => i.table === 'activeTimers')
  expect(insert).toBeDefined()
  return insert!.values
}

beforeEach(() => {
  state.rows = {}
  state.inserts = []
  state.deletes = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

describe('POST /api/admin/timers', () => {
  it('persists the task owner on a task timer', async () => {
    state.rows.tasks = [{ orgId: 'org_client_b', requestId: null }]
    const res = await POST(makePost({ taskId: 'task1' }))
    expect(res.status).toBe(201)
    expect(startedTimer().orgId).toBe('org_client_b')
    expect(startedTimer().taskId).toBe('task1')
  })

  it('persists the request owner on a request timer', async () => {
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const res = await POST(makePost({ requestId: 'req1' }))
    expect(res.status).toBe(201)
    expect(startedTimer().orgId).toBe('org_client_a')
  })

  it('falls back to the studio org for a tahi_internal task instead of a null client', async () => {
    state.rows.tasks = [{ orgId: null, requestId: null, type: 'tahi_internal' }]
    const res = await POST(makePost({ taskId: 'task_internal' }))
    expect(res.status).toBe(201)
    expect(startedTimer().orgId).toBe('org_tahi_internal')
  })

  it('keeps a tahi_internal task on the studio org even when it hangs off a client request', async () => {
    // Following the request would file studio hours as billable client
    // hours and inflate that client's retainer burn.
    state.rows.tasks = [{ orgId: null, requestId: 'req_client', type: 'tahi_internal' }]
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const res = await POST(makePost({ taskId: 'task_internal' }))
    expect(res.status).toBe(201)
    expect(startedTimer().orgId).toBe('org_tahi_internal')
  })

  it('still follows the linked request for a client task with no client of its own', async () => {
    state.rows.tasks = [{ orgId: null, requestId: 'req_client', type: 'internal_client_task' }]
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const res = await POST(makePost({ taskId: 'task_client' }))
    expect(res.status).toBe(201)
    expect(startedTimer().orgId).toBe('org_client_a')
  })

  it('files an auto-stopped timer against its own client, not the new target', async () => {
    // Switching from a task at client B to a request at client A.
    state.rows.tasks = [{ orgId: 'org_client_b', requestId: null }]
    state.rows.requests = [{ orgId: 'org_client_a' }]
    state.rows.teamMembers = [{ id: 'tm_1' }]
    state.rows.activeTimers = [timerRow({ taskId: 'task_old' })]

    const res = await POST(makePost({ requestId: 'req_new' }, '?confirmed=true'))
    expect(res.status).toBe(201)

    const timeEntry = state.inserts.find(i => i.table === 'timeEntries')
    expect(timeEntry?.values.orgId).toBe('org_client_b')
    expect(timeEntry?.values.taskId).toBe('task_old')
    expect(startedTimer().orgId).toBe('org_client_a')

    const body = await res.json() as { stopped: { logged: boolean } | null }
    expect(body.stopped?.logged).toBe(true)
  })

  it('refuses to start a second timer without confirmation', async () => {
    state.rows.tasks = [{ orgId: 'org_client_b', requestId: null }]
    state.rows.activeTimers = [timerRow({ taskId: 'task_old' })]
    const res = await POST(makePost({ taskId: 'task_new' }))
    expect(res.status).toBe(409)
    expect(state.inserts.filter(i => i.table === 'timeEntries')).toHaveLength(0)
  })
})

describe('DELETE /api/admin/timers/[id]', () => {
  const params = { params: Promise.resolve({ id: 'timer_old' }) }

  it('logs a task timer against the task owner', async () => {
    state.rows.activeTimers = [timerRow({ taskId: 'task_old', orgId: 'org_client_b' })]
    state.rows.tasks = [{ orgId: 'org_client_b', requestId: null }]
    state.rows.teamMembers = [{ id: 'tm_1' }]

    const res = await DELETE(makeDelete('timer_old'), params)
    const body = await res.json() as { logged: boolean; hours: number }
    expect(body.logged).toBe(true)
    expect(state.inserts.find(i => i.table === 'timeEntries')?.values.orgId).toBe('org_client_b')
    expect(state.deletes).toContain('activeTimers')
  })

  it('reports logged:false with a reason when the user has no team member row', async () => {
    state.rows.activeTimers = [timerRow({ taskId: 'task_old', orgId: 'org_client_b' })]
    state.rows.tasks = [{ orgId: 'org_client_b', requestId: null }]
    state.rows.teamMembers = []

    const res = await DELETE(makeDelete('timer_old'), params)
    const body = await res.json() as { ok: boolean; logged: boolean; reason: string; reasonMessage: string }
    expect(res.status).toBe(200)
    expect(body.logged).toBe(false)
    expect(body.reason).toBe('no_team_member_row_for_user')
    expect(body.reasonMessage).toContain('not logged')
    expect(state.inserts.filter(i => i.table === 'timeEntries')).toHaveLength(0)
    // The timer still stops, so the user is not left with a zombie.
    expect(state.deletes).toContain('activeTimers')
  })

  it('discards without logging when asked to', async () => {
    state.rows.activeTimers = [timerRow({ taskId: 'task_old', orgId: 'org_client_b' })]
    const res = await DELETE(makeDelete('timer_old', 'discard'), params)
    const body = await res.json() as { logged: boolean }
    expect(body.logged).toBe(false)
    expect(state.inserts.filter(i => i.table === 'timeEntries')).toHaveLength(0)
  })
})
