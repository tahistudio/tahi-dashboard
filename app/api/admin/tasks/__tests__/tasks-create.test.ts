/**
 * POST /api/admin/tasks.
 *
 * Five things this route got wrong before the Tasks port and must not get
 * wrong again: it collapsed internal_client_task into client_task, it did not
 * validate the priority (so a template could write a value PATCH then
 * refused), it accepted a `subtasks` array from the new-task dialog and
 * silently threw it away, it dropped a `requestId` sent without an `orgId`
 * instead of adopting the request's client, and it filed a task under any
 * client the caller named without checking the caller could see it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const inserted: { table: string; values: Record<string, unknown> }[] = []
const accessChecked: (string | null | undefined)[] = []
let requestOrgs: Record<string, string> = {}
let deniedOrgIds: string[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: { tasks: { __name: 'tasks' }, taskSubtasks: { __name: 'task_subtasks' } },
}))

vi.mock('@/lib/task-access', () => ({
  requestOrgId: async (_drizzle: unknown, requestId: string) => requestOrgs[requestId] ?? null,
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
    insert: (table: { __name: string }) => ({
      values: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const v of Array.isArray(values) ? values : [values]) {
          inserted.push({ table: table.__name, values: v })
        }
      },
    }),
  }),
}))

const { POST } = await import('../route')

function post(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/tasks', () => {
  beforeEach(() => {
    inserted.length = 0
    accessChecked.length = 0
    requestOrgs = { r1: 'o1' }
    deniedOrgIds = []
  })

  it('keeps internal_client_task rather than collapsing it', async () => {
    const res = await POST(post({ title: 'Chase GA4', type: 'internal_client_task', orgId: 'o1' }) as never)
    expect(res.status).toBe(201)
    expect(inserted[0].values.type).toBe('internal_client_task')
    expect(inserted[0].values.orgId).toBe('o1')
  })

  it('rejects a client-flavoured level with no client', async () => {
    const res = await POST(post({ title: 'x', type: 'internal_client_task' }) as never)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Client is required for a client task' })
  })

  it('drops the client and the request on a tahi_internal task', async () => {
    await POST(post({ title: 'Tidy the drive', type: 'tahi_internal', orgId: 'o1', requestId: 'r1' }) as never)
    expect(inserted[0].values.orgId).toBeNull()
    expect(inserted[0].values.requestId).toBeNull()
  })

  it('derives the level from orgId when type is omitted', async () => {
    await POST(post({ title: 'x', orgId: 'o1' }) as never)
    expect(inserted[0].values.type).toBe('client_task')
  })

  it('rejects a priority outside the repo scale', async () => {
    const res = await POST(post({ title: 'x', priority: 'medium' }) as never)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid priority' })
  })

  it('reads an explicit null priority as standard rather than 400ing', async () => {
    const res = await POST(post({ title: 'x', priority: null }) as never)
    expect(res.status).toBe(201)
    expect(inserted[0].values.priority).toBe('standard')
  })

  it('adopts the request client when only a request is named', async () => {
    const res = await POST(post({ title: 'Fix the hero', requestId: 'r1' }) as never)
    expect(res.status).toBe(201)
    expect(inserted[0].values.requestId).toBe('r1')
    expect(inserted[0].values.orgId).toBe('o1')
    expect(inserted[0].values.type).toBe('client_task')
  })

  it('keeps an internal level while adopting the request client', async () => {
    await POST(post({ title: 'x', type: 'internal_client_task', requestId: 'r1' }) as never)
    expect(inserted[0].values.type).toBe('internal_client_task')
    expect(inserted[0].values.orgId).toBe('o1')
    expect(inserted[0].values.requestId).toBe('r1')
  })

  it('404s a request that does not exist rather than dropping the link', async () => {
    const res = await POST(post({ title: 'x', requestId: 'ghost' }) as never)
    expect(res.status).toBe(404)
    expect(inserted).toHaveLength(0)
  })

  it('checks the caller may reach the client it is filing under', async () => {
    await POST(post({ title: 'x', orgId: 'o1' }) as never)
    expect(accessChecked).toEqual(['o1'])

    deniedOrgIds = ['o2']
    const res = await POST(post({ title: 'x', orgId: 'o2' }) as never)
    expect(res.status).toBe(403)
    expect(inserted).toHaveLength(1)
  })

  it('does not gate a task with no client', async () => {
    await POST(post({ title: 'Tidy the drive' }) as never)
    expect(accessChecked).toHaveLength(0)
    expect(inserted).toHaveLength(1)
  })

  it('accepts a valid status instead of always writing todo', async () => {
    await POST(post({ title: 'x', status: 'in_progress' }) as never)
    expect(inserted[0].values.status).toBe('in_progress')
  })

  it('rejects an unknown status', async () => {
    const res = await POST(post({ title: 'x', status: 'shipped' }) as never)
    expect(res.status).toBe(400)
  })

  it('persists the subtask titles it is handed', async () => {
    await POST(post({ title: 'x', subtasks: ['One', '  Two  ', '', '   '] }) as never)
    const subs = inserted.filter(i => i.table === 'task_subtasks')
    expect(subs.map(s => s.values.title)).toEqual(['One', 'Two'])
    expect(subs.every(s => s.values.taskId === inserted[0].values.id)).toBe(true)
  })

  it('stores the estimate', async () => {
    await POST(post({ title: 'x', estimatedHours: 2.5 }) as never)
    expect(inserted[0].values.estimatedHours).toBe(2.5)
  })
})
