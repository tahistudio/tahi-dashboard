/**
 * PATCH /api/admin/tasks/[id].
 *
 * The level, the client and the request are one state. Before the Tasks port
 * this route wrote the client and the request as two independent columns and
 * never accepted the level at all, so the detail panel's Level control and the
 * MCP tool's `type` argument both answered 200 and changed nothing, and
 * setting a client on a Tahi task stored a level that could not be true. It
 * also gated only on the client the task sat in, never on the one it was being
 * moved to.
 *
 * The invariants themselves live in lib/task-consistency.ts and are exercised
 * for real here; only the reads and the access rule are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

interface Links { type: string; orgId: string | null; requestId: string | null }

const updates: Record<string, unknown>[] = []
const accessChecked: (string | null | undefined)[] = []
let current: Links | null = null
let requestOrgs: Record<string, string> = {}
let deniedOrgIds: string[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: {
    tasks: { id: 'id', title: 'title' },
    organisations: { id: 'id', name: 'name' },
  },
}))

const notified: Record<string, unknown>[] = []
let assigneeKinds: Record<string, 'team_member' | 'contact'> = {}

vi.mock('@/lib/notifications', () => ({
  createNotification: async (_drizzle: unknown, input: Record<string, unknown>) => { notified.push(input) },
}))

vi.mock('@/lib/task-access', () => ({
  guardTask: async () => null,
  loadTaskLinks: async () => current,
  requestOrgId: async (_drizzle: unknown, requestId: string) => requestOrgs[requestId] ?? null,
  resolveAssigneeType: async (_drizzle: unknown, assigneeId: string) => assigneeKinds[assigneeId] ?? null,
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: async (_drizzle: unknown, _userId: string | null, targetOrgId: string | null) => {
    accessChecked.push(targetOrgId)
    return targetOrgId && deniedOrgIds.includes(targetOrgId)
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : null
  },
}))

vi.mock('@/lib/db', () => ({
  db: async () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push(values) },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ title: 'A task' }] }),
      }),
    }),
  }),
}))

const { PATCH } = await import('../[id]/route')

const params = { params: Promise.resolve({ id: 't1' }) }

function patch(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks/t1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/admin/tasks/[id] link invariants', () => {
  beforeEach(() => {
    updates.length = 0
    accessChecked.length = 0
    requestOrgs = { r1: 'o1', r2: 'o2' }
    deniedOrgIds = []
    current = { type: 'client_task', orgId: 'o1', requestId: null }
  })

  it('persists a Client to Internal change', async () => {
    const res = await PATCH(patch({ type: 'internal_client_task' }) as never, params)
    expect(res.status).toBe(200)
    expect(updates[0].type).toBe('internal_client_task')
    expect(updates[0].orgId).toBe('o1')
    expect(updates[0].requestId).toBeNull()
  })

  it('clears the client and the request on a move to Tahi', async () => {
    current = { type: 'client_task', orgId: 'o1', requestId: 'r1' }
    await PATCH(patch({ type: 'tahi_internal' }) as never, params)
    expect(updates[0].type).toBe('tahi_internal')
    expect(updates[0].orgId).toBeNull()
    expect(updates[0].requestId).toBeNull()
  })

  it('lifts the level with the client when a Tahi task gains one', async () => {
    current = { type: 'tahi_internal', orgId: null, requestId: null }
    await PATCH(patch({ orgId: 'o1' }) as never, params)
    expect(updates[0].type).toBe('internal_client_task')
    expect(updates[0].orgId).toBe('o1')
  })

  it('drops to Tahi when the client is cleared', async () => {
    current = { type: 'client_task', orgId: 'o1', requestId: 'r1' }
    await PATCH(patch({ orgId: null }) as never, params)
    expect(updates[0].type).toBe('tahi_internal')
    expect(updates[0].orgId).toBeNull()
    expect(updates[0].requestId).toBeNull()
  })

  it('rejects a level outside the three', async () => {
    const res = await PATCH(patch({ type: 'client' }) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid level' })
    expect(updates).toHaveLength(0)
  })

  it('rejects a client level with no client rather than reverting silently', async () => {
    current = { type: 'tahi_internal', orgId: null, requestId: null }
    const res = await PATCH(patch({ type: 'client_task' }) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Client is required for a client task' })
    expect(updates).toHaveLength(0)
  })

  it('adopts the request client when a Tahi task is linked to a request', async () => {
    current = { type: 'tahi_internal', orgId: null, requestId: null }
    await PATCH(patch({ requestId: 'r1' }) as never, params)
    expect(updates[0].type).toBe('client_task')
    expect(updates[0].orgId).toBe('o1')
    expect(updates[0].requestId).toBe('r1')
  })

  it('404s a request that does not exist rather than dropping the link', async () => {
    const res = await PATCH(patch({ requestId: 'ghost' }) as never, params)
    expect(res.status).toBe(404)
    expect(updates).toHaveLength(0)
  })

  it('lets a client stated in the same call win over a foreign request', async () => {
    current = { type: 'client_task', orgId: 'o1', requestId: 'r1' }
    await PATCH(patch({ orgId: 'o2', requestId: 'r1' }) as never, params)
    expect(updates[0].orgId).toBe('o2')
    expect(updates[0].requestId).toBeNull()
  })

  it('checks the caller may reach the client the task is moving to', async () => {
    deniedOrgIds = ['o2']
    const res = await PATCH(patch({ orgId: 'o2' }) as never, params)
    expect(res.status).toBe(403)
    expect(accessChecked).toEqual(['o2'])
    expect(updates).toHaveLength(0)
  })

  it('does not re-check the client the task already sits in', async () => {
    await PATCH(patch({ orgId: 'o1' }) as never, params)
    expect(accessChecked).toHaveLength(0)
    expect(updates).toHaveLength(1)
  })

  it('leaves the triple alone when the patch does not touch it', async () => {
    await PATCH(patch({ status: 'done' }) as never, params)
    expect(updates[0]).not.toHaveProperty('type')
    expect(updates[0]).not.toHaveProperty('orgId')
    expect(updates[0]).not.toHaveProperty('requestId')
    expect(updates[0].status).toBe('done')
  })
})

describe('PATCH /api/admin/tasks/[id] assignee type', () => {
  beforeEach(() => {
    updates.length = 0
    notified.length = 0
    requestOrgs = {}
    deniedOrgIds = []
    current = { type: 'tahi_internal', orgId: null, requestId: null }
    assigneeKinds = { tm1: 'team_member', c1: 'contact' }
  })

  it('derives team_member from the id when the caller sends the id alone', async () => {
    const res = await PATCH(patch({ assigneeId: 'tm1' }) as never, params)
    expect(res.status).toBe(200)
    expect(updates[0].assigneeId).toBe('tm1')
    expect(updates[0].assigneeType).toBe('team_member')
    expect(notified[0]?.recipient).toEqual({ teamMemberId: 'tm1' })
  })

  it('derives contact and addresses the notification to the contact', async () => {
    const res = await PATCH(patch({ assigneeId: 'c1' }) as never, params)
    expect(res.status).toBe(200)
    expect(updates[0].assigneeType).toBe('contact')
    expect(notified[0]?.recipient).toEqual({ contactId: 'c1' })
  })

  it('clears the type with the assignee', async () => {
    const res = await PATCH(patch({ assigneeId: null }) as never, params)
    expect(res.status).toBe(200)
    expect(updates[0].assigneeId).toBeNull()
    expect(updates[0].assigneeType).toBeNull()
    expect(notified).toHaveLength(0)
  })

  it('keeps an explicit type the caller states', async () => {
    const res = await PATCH(patch({ assigneeId: 'c1', assigneeType: 'contact' }) as never, params)
    expect(res.status).toBe(200)
    expect(updates[0].assigneeType).toBe('contact')
  })

  it('refuses an id that names nobody', async () => {
    const res = await PATCH(patch({ assigneeId: 'ghost' }) as never, params)
    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
