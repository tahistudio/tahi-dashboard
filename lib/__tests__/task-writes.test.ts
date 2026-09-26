/**
 * lib/task-writes.ts, the one code path that creates and updates a task.
 *
 * The two route handlers had the insert and the update inline, so the only
 * way for an automation to write a task exactly the way the dashboard does
 * was to call the HTTP route from inside the worker. Applying an approved
 * call suggestion needs the same rules without the request, so both bodies
 * moved here and both routes call them.
 *
 * The route tests (app/api/admin/tasks/__tests__) still exercise every rule
 * through the doors; what is pinned HERE is what is new or what only this
 * module can be asked: the audit entry neither route used to write, and the
 * system actor that applies a suggestion without a signed-in human to gate
 * the client on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { schema } from '@/db/d1'

const accessChecked: Array<string | null | undefined> = []
let deniedOrgIds: string[] = []
const notified: Array<Record<string, unknown>> = []

// The Slack thread line (CN.3): armed only when the token is set, exactly as
// the real gate is, with the queue recorded rather than deferred.
vi.mock('@/lib/slack/work-sync', async () => {
  const actual = await vi.importActual<typeof import('@/lib/slack/work-sync')>('@/lib/slack/work-sync')
  return {
    ...actual,
    workSyncArmed: () => !!process.env.SLACK_BOT_TOKEN,
    queueWorkSync: vi.fn(async () => undefined),
  }
})
const { queueWorkSync } = await import('@/lib/slack/work-sync')

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: async (_drizzle: unknown, _userId: string | null, targetOrgId: string | null) => {
    accessChecked.push(targetOrgId)
    return targetOrgId && deniedOrgIds.includes(targetOrgId)
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : null
  },
}))

vi.mock('@/lib/notifications', () => ({
  createNotification: async (_drizzle: unknown, input: Record<string, unknown>) => {
    notified.push(input)
    return { delivered: 1, skipped: 0 }
  },
}))

vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: async () => null,
}))

vi.mock('@/lib/task-access', () => ({
  loadTaskLinks: async () => ({ type: 'tahi_internal', orgId: null, requestId: null }),
  requestOrgId: async () => 'o1',
  resolveAssigneeType: async (_drizzle: unknown, id: string) => (id.startsWith('tm') ? 'team_member' : null),
}))

const { createTaskRecord, updateTaskRecord } = await import('../task-writes')

interface Recorded { table: unknown; values: Record<string, unknown> }

function fakeDrizzle(
  taskRow: Record<string, unknown> | null = { id: 't1', title: 'A task', status: 'todo' },
  /** Rows the first selects answer with, in order, before `taskRow` takes over. */
  firstSelects: Array<Record<string, unknown> | null> = [],
) {
  const inserted: Recorded[] = []
  const updated: Array<Record<string, unknown>> = []
  const selects = { count: 0 }
  const database = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserted.push({ table, values })
          return Promise.resolve()
        },
      }
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updated.push(values)
          return { where: async () => undefined }
        },
      }
    },
    select() {
      const index = selects.count
      selects.count += 1
      const row = index < firstSelects.length ? firstSelects[index] : taskRow
      return {
        from() {
          return {
            where() {
              return { limit: async () => (row ? [row] : []) }
            },
          }
        },
      }
    },
  }
  return { database: database as unknown as Parameters<typeof createTaskRecord>[0], inserted, updated, selects }
}

const HUMAN = { actorType: 'team_member' as const, actorId: 'user_1' }
const SYSTEM = { actorType: 'system' as const, actorId: 'user_1' }

beforeEach(() => {
  accessChecked.length = 0
  deniedOrgIds = []
  notified.length = 0
  vi.mocked(queueWorkSync).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createTaskRecord', () => {
  it('returns the row it wrote, so a caller does not have to read it back', async () => {
    const { database, inserted } = fakeDrizzle()
    const result = await createTaskRecord(database, { title: '  Cut the hero video  ' }, HUMAN)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.task.title).toBe('Cut the hero video')
    expect(result.task.type).toBe('tahi_internal')
    expect(result.task.id).toBe(inserted[0].values.id)
  })

  it('writes a task.created audit entry carrying the actor', async () => {
    const { database, inserted } = fakeDrizzle()
    await createTaskRecord(database, { title: 'Chase GA4' }, HUMAN)

    const audit = inserted.find(row => row.table === schema.auditLog)
    expect(audit).toBeDefined()
    expect(audit?.values.action).toBe('task.created')
    expect(audit?.values.actorType).toBe('team_member')
    expect(audit?.values.actorId).toBe('user_1')
    expect(audit?.values.entityType).toBe('task')
  })

  it('records a system apply as system, not as the founder who clicked', async () => {
    const { database, inserted } = fakeDrizzle()
    await createTaskRecord(database, { title: 'From a call' }, SYSTEM)

    const audit = inserted.find(row => row.table === schema.auditLog)
    expect(audit?.values.actorType).toBe('system')
  })

  it('gates a human on the client it is filing under', async () => {
    const { database } = fakeDrizzle()
    deniedOrgIds = ['o2']
    const result = await createTaskRecord(database, { title: 'x', orgId: 'o2' }, HUMAN)

    expect(accessChecked).toEqual(['o2'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ status: 403, error: 'Forbidden' })
  })

  it('does not gate a system apply, which has no signed-in human to scope', async () => {
    const { database, inserted } = fakeDrizzle()
    deniedOrgIds = ['o2']
    const result = await createTaskRecord(database, { title: 'x', orgId: 'o2' }, SYSTEM)

    expect(accessChecked).toEqual([])
    expect(result.ok).toBe(true)
    expect(inserted[0].values.orgId).toBe('o2')
  })

  it('refuses a blank title rather than writing an untitled row', async () => {
    const { database, inserted } = fakeDrizzle()
    const result = await createTaskRecord(database, { title: '   ' }, HUMAN)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ status: 400, error: 'Title is required' })
    expect(inserted).toHaveLength(0)
  })
})

describe('updateTaskRecord', () => {
  it('writes a task.updated audit entry', async () => {
    const { database, inserted, updated } = fakeDrizzle()
    const result = await updateTaskRecord(database, 't1', { status: 'done' }, HUMAN)

    expect(result.ok).toBe(true)
    expect(updated[0].status).toBe('done')
    const audit = inserted.find(row => row.table === schema.auditLog)
    expect(audit?.values.action).toBe('task.updated')
    expect(audit?.values.entityId).toBe('t1')
  })

  it('returns the task as it stands after the write', async () => {
    const { database } = fakeDrizzle({ id: 't1', title: 'A task', status: 'done' })
    const result = await updateTaskRecord(database, 't1', { status: 'done' }, SYSTEM)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.task.title).toBe('A task')
    expect(result.task.status).toBe('done')
  })

  it('404s a task that vanished under it rather than reporting success', async () => {
    const { database } = fakeDrizzle(null)
    const result = await updateTaskRecord(database, 'ghost', { status: 'done' }, SYSTEM)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.status).toBe(404)
  })

  it('refuses an invalid status without touching the row', async () => {
    const { database, updated } = fakeDrizzle()
    const result = await updateTaskRecord(database, 't1', { status: 'shipped' }, HUMAN)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ status: 400, error: 'Invalid status' })
    expect(updated).toHaveLength(0)
  })
})

describe('updateTaskRecord and the Slack thread line (CN.3)', () => {
  const BEFORE = { status: 'todo', assigneeId: null, dueDate: null, priority: 'standard', title: 'A task' }

  it('reads nothing extra and queues nothing while Slack is not configured', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const { database, selects } = fakeDrizzle()
    const result = await updateTaskRecord(database, 't1', { status: 'done' }, HUMAN)

    expect(result.ok).toBe(true)
    // The one select is readTask, which the writer has always done.
    expect(selects.count).toBe(1)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })

  it('queues a person\'s status change with the before and after', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { database, selects } = fakeDrizzle({ id: 't1', title: 'A task', status: 'done' }, [BEFORE])
    await updateTaskRecord(database, 't1', { status: 'done' }, HUMAN)

    expect(selects.count).toBe(2)
    expect(vi.mocked(queueWorkSync)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(queueWorkSync).mock.calls[0][1]).toEqual([{
      entityType: 'task',
      entityId: 't1',
      actor: { type: 'studio', clerkUserId: 'user_1' },
      changes: [{ field: 'status', from: 'todo', to: 'done' }],
    }])
  })

  it('diffs only the fields the patch wrote, with the assignee under its own name', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { database } = fakeDrizzle(undefined, [BEFORE])
    await updateTaskRecord(database, 't1', {
      assigneeId: 'tm_staci', dueDate: '2026-10-02', title: 'A task', description: 'not a line',
    }, HUMAN)

    expect(vi.mocked(queueWorkSync).mock.calls[0][1][0].changes).toEqual([
      { field: 'assignee', from: null, to: 'tm_staci' },
      { field: 'dueDate', from: null, to: '2026-10-02' },
    ])
  })

  it('queues nothing when the value did not move', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { database } = fakeDrizzle(undefined, [BEFORE])
    await updateTaskRecord(database, 't1', { status: 'todo' }, HUMAN)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })

  it('never reads or queues for a system apply, whose card already says it', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { database, selects } = fakeDrizzle()
    await updateTaskRecord(database, 't1', { status: 'done' }, SYSTEM)
    expect(selects.count).toBe(1)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })

  it('queues nothing for a refused patch', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const { database } = fakeDrizzle()
    await updateTaskRecord(database, 't1', { status: 'shipped' }, HUMAN)
    expect(vi.mocked(queueWorkSync)).not.toHaveBeenCalled()
  })
})
