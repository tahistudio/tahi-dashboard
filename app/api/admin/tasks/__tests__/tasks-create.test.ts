/**
 * POST /api/admin/tasks.
 *
 * Eight things this route got wrong before the Tasks port and must not get
 * wrong again: it collapsed internal_client_task into client_task, it did not
 * validate the priority (so a template could write a value PATCH then
 * refused), it accepted a `subtasks` array from the new-task dialog and
 * silently threw it away, it dropped a `requestId` sent without an `orgId`
 * instead of adopting the request's client, it filed a task under any
 * client the caller named without checking the caller could see it, it
 * created a task already assigned to somebody without telling them, it stored
 * the assignee's id with no kind beside it, and its first pass at telling them
 * would have put a Tahi-internal task title in a client contact's bell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const inserted: { table: string; values: Record<string, unknown> }[] = []
const accessChecked: (string | null | undefined)[] = []
const notified: Record<string, unknown>[] = []
let requestOrgs: Record<string, string> = {}
let deniedOrgIds: string[] = []
let assigneeTypes: Record<string, 'team_member' | 'contact'> = {}
let callerTeamMemberId: string | null = null

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: { tasks: { __name: 'tasks' }, taskSubtasks: { __name: 'task_subtasks' } },
}))

vi.mock('@/lib/task-access', () => ({
  requestOrgId: async (_drizzle: unknown, requestId: string) => requestOrgs[requestId] ?? null,
  resolveAssigneeType: async (_drizzle: unknown, assigneeId: string) =>
    assigneeTypes[assigneeId] ?? null,
}))

vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: async () =>
    callerTeamMemberId ? { id: callerTeamMemberId, role: 'admin' } : null,
}))

vi.mock('@/lib/notifications', () => ({
  createNotification: async (_drizzle: unknown, params: Record<string, unknown>) => {
    notified.push(params)
    return { delivered: 1, skipped: 0 }
  },
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
    notified.length = 0
    requestOrgs = { r1: 'o1' }
    deniedOrgIds = []
    assigneeTypes = { tm_staci: 'team_member', ct_dana: 'contact', tm_me: 'team_member' }
    callerTeamMemberId = 'tm_me'
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

  it('tells an assignee the task was created on them', async () => {
    const res = await POST(post({ title: 'Cut the hero video', assigneeId: 'tm_staci' }) as never)
    expect(res.status).toBe(201)
    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({
      recipient: { teamMemberId: 'tm_staci' },
      type: 'task_assigned',
      entityType: 'task',
      entityId: inserted[0].values.id,
    })
    expect(notified[0].title).toContain('Cut the hero video')
  })

  it('never tells a client contact about a task, whoever the id names', async () => {
    // Tasks are not a client surface: the portal has no task page, so the row
    // would be an unclickable dead end carrying an internal title. The task
    // still holds the contact; nobody outside the studio is told about it.
    const res = await POST(
      post({ title: 'Rewrite the SOW before we tell them', orgId: 'o1', assigneeId: 'ct_dana' }) as never,
    )
    expect(res.status).toBe(201)
    expect(notified).toHaveLength(0)
    expect(inserted[0].values.assigneeId).toBe('ct_dana')
  })

  it('stores the assignee kind it resolved rather than the null the dialog sends', async () => {
    await POST(post({ title: 'x', assigneeId: 'tm_staci' }) as never)
    expect(inserted[0].values.assigneeType).toBe('team_member')

    inserted.length = 0
    await POST(post({ title: 'x', orgId: 'o1', assigneeId: 'ct_dana' }) as never)
    expect(inserted[0].values.assigneeType).toBe('contact')
  })

  it('takes the assignee kind from the caller when they state one', async () => {
    assigneeTypes = {}
    await POST(post({ title: 'x', assigneeId: 'tm_staci', assigneeType: 'team_member' }) as never)
    expect(inserted[0].values.assigneeType).toBe('team_member')
    expect(notified).toHaveLength(1)
  })

  it('never notifies the creator about their own task', async () => {
    const res = await POST(post({ title: 'Read the brief', assigneeId: 'tm_me' }) as never)
    expect(res.status).toBe(201)
    expect(notified).toHaveLength(0)
    // Self-assigned still stores the kind: the column and the bell are two
    // uses of one answer, not two answers.
    expect(inserted[0].values.assigneeType).toBe('team_member')
  })

  it('notifies nobody when the task lands unassigned', async () => {
    await POST(post({ title: 'Unassigned for now' }) as never)
    expect(notified).toHaveLength(0)
    expect(inserted[0].values.assigneeType).toBeNull()
  })

  it('still creates the task when the assignee id matches no row', async () => {
    const res = await POST(post({ title: 'x', assigneeId: 'ghost' }) as never)
    expect(res.status).toBe(201)
    expect(notified).toHaveLength(0)
    expect(inserted[0].values.assigneeType).toBeNull()
  })
})
