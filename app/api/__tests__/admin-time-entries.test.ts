/**
 * Route tests for the shared manual time entry (POST /api/admin/time-entries).
 *
 * The gap this closes: time_entries.org_id is NOT NULL, so the route read the
 * task's org and 400'd "Cannot log time on this target (no org attached)" for
 * every studio task, which is the whole tahi_internal category. The live
 * timer had already solved the same problem by falling back to the request
 * the task hangs off and then to the hidden internal studio org, so the card
 * could time a Tahi task but not log one by hand.
 *
 * Both paths now resolve through resolveTimerOrgId, so manual and timed hours
 * on one task can never land on two different clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  rows: Record<string, Row[]>
  inserts: Array<{ table: string | undefined; values: Row }>
} = { rows: {}, inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'clerk_admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/internal-org', () => ({
  INTERNAL_ORG_ID: 'org_tahi_internal',
  ensureInternalOrg: vi.fn().mockResolvedValue('org_tahi_internal'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: { _table: 'requests', id: 1, orgId: 1 },
    tasks: { _table: 'tasks', id: 1, orgId: 1, requestId: 1, type: 1 },
    timeEntries: { _table: 'timeEntries', id: 1, date: 1 },
    teamMembers: { _table: 'teamMembers', id: 1, clerkUserId: 1 },
    // The shared writer (lib/time-entries.ts) reads the client's default
    // hourly rate when the body names none. Present here so this file
    // exercises the real path rather than the read-failed fallback.
    // The rate rule itself is covered in admin-time-rate.test.ts.
    organisations: { _table: 'organisations', id: 1, defaultHourlyRate: 1 },
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  desc: (a: unknown) => ({ op: 'desc', a }),
}))

vi.mock('@/lib/db', () => {
  function chainFor(name: string | undefined) {
    const rows = state.rows[name ?? ''] ?? []
    const chain = Promise.resolve(rows) as Promise<Row[]> & {
      where: () => typeof chain
      limit: () => typeof chain
      leftJoin: () => typeof chain
      orderBy: () => typeof chain
    }
    chain.where = () => chain
    chain.limit = () => chain
    chain.leftJoin = () => chain
    chain.orderBy = () => chain
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
    }),
  }
})

import { POST } from '@/app/api/admin/time-entries/route'
import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/time-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function loggedEntry(): Row {
  const insert = state.inserts.find(i => i.table === 'timeEntries')
  expect(insert).toBeDefined()
  return insert!.values
}

beforeEach(() => {
  state.rows = {}
  state.inserts = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

describe('POST /api/admin/time-entries', () => {
  it('logs a client task against its own client', async () => {
    state.rows.tasks = [{ orgId: 'org_client_a', requestId: null, type: 'client_task' }]
    const res = await POST(makePost({ taskId: 'task_client', hours: 1.5 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().orgId).toBe('org_client_a')
    expect(loggedEntry().taskId).toBe('task_client')
  })

  it('logs a studio task with no client instead of refusing it', async () => {
    state.rows.tasks = [{ orgId: null, requestId: null, type: 'tahi_internal' }]
    const res = await POST(makePost({ taskId: 'task_internal', hours: 0.5, notes: 'Tidy the drive' }))
    expect(res.status).toBe(201)
    expect(loggedEntry().orgId).toBe('org_tahi_internal')
    expect(loggedEntry().hours).toBe(0.5)
  })

  it('keeps a studio task off the client of the request it hangs from', async () => {
    // Following the request would file studio hours as billable client hours
    // and inflate that client's retainer burn. Same rule as the timer.
    state.rows.tasks = [{ orgId: null, requestId: 'req_client', type: 'tahi_internal' }]
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const res = await POST(makePost({ taskId: 'task_internal', hours: 2 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().orgId).toBe('org_tahi_internal')
  })

  it('still follows the linked request for a client task with no client of its own', async () => {
    state.rows.tasks = [{ orgId: null, requestId: 'req_client', type: 'internal_client_task' }]
    state.rows.requests = [{ orgId: 'org_client_a' }]
    const res = await POST(makePost({ taskId: 'task_client', hours: 1 }))
    expect(res.status).toBe(201)
    expect(loggedEntry().orgId).toBe('org_client_a')
  })

  it('404s a task that does not exist rather than inventing an org for it', async () => {
    state.rows.tasks = []
    const res = await POST(makePost({ taskId: 'nope', hours: 1 }))
    expect(res.status).toBe(404)
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects a body naming both a request and a task', async () => {
    const res = await POST(makePost({ taskId: 't1', requestId: 'r1', hours: 1 }))
    expect(res.status).toBe(400)
  })
})
