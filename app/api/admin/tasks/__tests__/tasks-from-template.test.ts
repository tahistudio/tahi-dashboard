/**
 * POST /api/admin/tasks/from-template.
 *
 * The third create door, reachable from the dashboard's template picker and
 * from the MCP create_task_from_template tool. It takes an assigneeId, writes
 * it with assigneeType 'team_member', and used to tell nobody: the task simply
 * appeared on the board and waited to be noticed. POST /api/admin/tasks and
 * PATCH /api/admin/tasks/[id] both tell the assignee, so this one now does
 * too, on the same two rules: never a contact, and never the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted: { table: string; values: Record<string, unknown> }[] = []
const notified: Record<string, unknown>[] = []
let template: Record<string, unknown> | null = null
let callerTeamMemberId: string | null = null

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: {
    tasks: { __name: 'tasks' },
    taskSubtasks: { __name: 'task_subtasks' },
    taskTemplates: { __name: 'task_templates' },
  },
}))

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: async () => null,
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

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (template ? [template] : []) }),
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: async (values: Record<string, unknown>) => {
        inserted.push({ table: table.__name, values })
      },
    }),
  }),
}))

const { POST } = await import('../from-template/route')

function post(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks/from-template', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/tasks/from-template', () => {
  beforeEach(() => {
    inserted.length = 0
    notified.length = 0
    callerTeamMemberId = 'tm_me'
    template = {
      id: 'tpl1',
      name: 'Monthly SEO sweep',
      description: null,
      type: 'tahi_internal',
      defaultPriority: 'medium',
      estimatedHours: 2,
      subtasks: '["Crawl","Report"]',
    }
  })

  it('tells the assignee the template handed them work', async () => {
    const res = await POST(post({ templateId: 'tpl1', assigneeId: 'tm_staci' }) as never)
    expect(res.status).toBe(201)
    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({
      recipient: { teamMemberId: 'tm_staci' },
      type: 'task_assigned',
      entityType: 'task',
      entityId: inserted[0].values.id,
    })
    expect(notified[0].title).toContain('Monthly SEO sweep')
  })

  it('says nothing when the caller applies the template to themselves', async () => {
    callerTeamMemberId = 'tm_staci'
    await POST(post({ templateId: 'tpl1', assigneeId: 'tm_staci' }) as never)
    expect(notified).toHaveLength(0)
  })

  it('says nothing when the template is applied unassigned', async () => {
    await POST(post({ templateId: 'tpl1' }) as never)
    expect(inserted[0].values.assigneeId).toBeNull()
    expect(inserted[0].values.assigneeType).toBeNull()
    expect(notified).toHaveLength(0)
  })

  it('notifies nobody about a template that does not exist', async () => {
    template = null
    const res = await POST(post({ templateId: 'ghost', assigneeId: 'tm_staci' }) as never)
    expect(res.status).toBe(404)
    expect(inserted).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })
})
