/**
 * Contract tests for the task list + subtasks GET shapes. These guard the
 * data-contract bugs the UX review found: the list must enrich each task with
 * subtaskDone + blockedByCount, and the subtasks endpoint must key its payload
 * `subtasks` (not `items`).
 *
 * The drizzle instance is a thenable query-builder stub: every chain method
 * returns the same builder, and awaiting it resolves the next queued result in
 * call order. No real database is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'u_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((o: string | null) => o === 'org_tahi'),
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/db/d1', () => ({
  schema: {
    tasks: {
      id: 'id', type: 'type', orgId: 'org_id', title: 'title', description: 'description',
      status: 'status', priority: 'priority', assigneeId: 'assignee_id', assigneeType: 'assignee_type',
      dueDate: 'due_date', completedAt: 'completed_at', createdById: 'created_by_id', tags: 'tags',
      trackId: 'track_id', position: 'position', requestId: 'request_id', scheduleRowId: 'schedule_row_id',
      createdAt: 'created_at', updatedAt: 'updated_at',
    },
    organisations: { id: 'id', name: 'name' },
    teamMembers: { id: 'id', clerkUserId: 'clerk_user_id' },
    taskSubtasks: { id: 'id', taskId: 'task_id', title: 'title', completed: 'completed', createdAt: 'created_at' },
    taskDependencies: { id: 'id', taskId: 'task_id', dependsOnTaskId: 'depends_on_task_id', createdAt: 'created_at' },
    // Since 0088 the count comes from work_blockers through
    // openBlockerCounts, which also reaches `requests` when a blocker is one.
    // Both keys have to exist or the drizzle stub's column references are
    // undefined at runtime.
    workBlockers: {
      id: 'id', blockedType: 'blocked_type', blockedId: 'blocked_id',
      blockerType: 'blocker_type', blockerId: 'blocker_id', createdAt: 'created_at',
    },
    requests: { id: 'id', status: 'status' },
  },
}))

import { db } from '@/lib/db'
import { GET as listTasks } from '@/app/api/admin/tasks/route'
import { GET as listSubtasks } from '@/app/api/admin/tasks/[id]/subtasks/route'
import { NextRequest } from 'next/server'

// Build a drizzle stub whose awaits resolve `queue` in call order.
function makeDrizzle(queue: unknown[]) {
  function builder() {
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.from = chain
    b.leftJoin = chain
    b.where = chain
    b.orderBy = chain
    b.groupBy = chain
    b.limit = chain
    b.then = (resolve: (v: unknown) => void) => resolve(queue.length ? queue.shift() : [])
    return b
  }
  return { select: () => builder() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/tasks enrichment', () => {
  it('returns subtaskDone and blockedByCount per task', async () => {
    const queue: unknown[] = [
      // 1) main task rows
      [{ id: 't1', type: 'tahi_internal', orgId: null, title: 'A', status: 'todo', priority: 'standard' }],
      // 2) grouped subtask counts (total 3, done 1)
      [{ taskId: 't1', count: 3, done: 1 }],
      // 3) work_blockers links for these tasks
      [
        { blockedId: 't1', blockerType: 'task', blockerId: 't2' },
        { blockedId: 't1', blockerType: 'task', blockerId: 't3' },
      ],
      // 4) the statuses of those blocking tasks (one open, one done)
      [{ id: 't2', status: 'todo' }, { id: 't3', status: 'done' }],
    ]
    vi.mocked(db).mockResolvedValue(makeDrizzle(queue) as never)

    const res = await listTasks(new NextRequest('http://localhost/api/admin/tasks'))
    expect(res.status).toBe(200)
    const json = await res.json() as { tasks: Array<{ id: string; subtaskCount: number; subtaskDone: number; blockedByCount: number }> }

    expect(json.tasks).toHaveLength(1)
    const t = json.tasks[0]
    expect(t.subtaskCount).toBe(3)
    expect(t.subtaskDone).toBe(1)
    // Only the blocker that is not done counts.
    expect(t.blockedByCount).toBe(1)
  })

  it('defaults subtaskDone and blockedByCount to 0 with no subtasks or blockers', async () => {
    const queue: unknown[] = [
      [{ id: 't1', type: 'tahi_internal', orgId: null, title: 'A', status: 'todo', priority: 'standard' }],
      [], // no subtasks
      [], // no blocker links, so no status lookup follows
    ]
    vi.mocked(db).mockResolvedValue(makeDrizzle(queue) as never)

    const res = await listTasks(new NextRequest('http://localhost/api/admin/tasks'))
    const json = await res.json() as { tasks: Array<{ subtaskDone: number; blockedByCount: number }> }
    expect(json.tasks[0].subtaskDone).toBe(0)
    expect(json.tasks[0].blockedByCount).toBe(0)
  })

  it('counts a request blocker, with the request closed set rather than the task one', async () => {
    const queue: unknown[] = [
      [{ id: 't1', type: 'tahi_internal', orgId: null, title: 'A', status: 'todo', priority: 'standard' }],
      [], // no subtasks
      // Two request blockers. 'delivered' closes a request; it is not 'done',
      // which is what the old inline literal would have counted as open.
      [
        { blockedId: 't1', blockerType: 'request', blockerId: 'r1' },
        { blockedId: 't1', blockerType: 'request', blockerId: 'r2' },
      ],
      [{ id: 'r1', status: 'in_progress' }, { id: 'r2', status: 'delivered' }],
    ]
    vi.mocked(db).mockResolvedValue(makeDrizzle(queue) as never)

    const res = await listTasks(new NextRequest('http://localhost/api/admin/tasks'))
    const json = await res.json() as { tasks: Array<{ blockedByCount: number }> }
    expect(json.tasks[0].blockedByCount).toBe(1)
  })

  it('drops the unread dependencies array it used to ship on every row', async () => {
    const queue: unknown[] = [
      [{ id: 't1', type: 'tahi_internal', orgId: null, title: 'A', status: 'todo', priority: 'standard' }],
      [],
      [],
    ]
    vi.mocked(db).mockResolvedValue(makeDrizzle(queue) as never)

    const res = await listTasks(new NextRequest('http://localhost/api/admin/tasks'))
    const json = await res.json() as { tasks: Array<Record<string, unknown>> }
    expect(json.tasks[0]).not.toHaveProperty('dependencies')
  })
})

describe('GET /api/admin/tasks/[id]/subtasks shape', () => {
  it('keys the payload `subtasks`, not `items`', async () => {
    const queue: unknown[] = [
      [{ id: 't1' }], // task-exists check
      [{ id: 's1', taskId: 't1', title: 'Sub', completed: false, createdAt: '2026-08-19T00:00:00Z' }],
    ]
    vi.mocked(db).mockResolvedValue(makeDrizzle(queue) as never)

    const res = await listSubtasks(
      new NextRequest('http://localhost/api/admin/tasks/t1/subtasks'),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json() as { subtasks?: unknown[]; items?: unknown[] }
    expect(Array.isArray(json.subtasks)).toBe(true)
    expect(json.subtasks).toHaveLength(1)
    expect(json.items).toBeUndefined()
  })
})
