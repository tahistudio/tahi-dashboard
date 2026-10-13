/**
 * POST /api/admin/tasks/from-template.
 *
 * The third create door, reachable from the dashboard's template picker and
 * from the MCP create_task_from_template tool. It takes an assigneeId, writes
 * it with assigneeType 'team_member', and used to tell nobody: the task simply
 * appeared on the board and waited to be noticed. POST /api/admin/tasks and
 * PATCH /api/admin/tasks/[id] both tell the assignee, so this one now does
 * too, on the same two rules: never a contact, and never the caller.
 *
 * "Never the caller" needs help from the caller on this door, because the MCP
 * server authenticates as the service user rather than as a team member's
 * login. It may name itself with actorTeamMemberId, which the route prefers
 * over the login lookup, exactly as POST /api/admin/tasks does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserted: { table: string; values: Record<string, unknown> }[] = []
const notified: Record<string, unknown>[] = []
let template: Record<string, unknown> | null = null
let callerTeamMemberId: string | null = null
let trackOrgId: string | null = null
let scheduleOrgId: string | null = null

// Feature access is granted for these task behaviour fixtures.
// Denial wiring is exercised with the real guard in permission-write-guards.test.ts.
vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => null }))

let authResult: Record<string, unknown> = { orgId: 'tahi-org', userId: 'user_1' }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => authResult,
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: {
    tasks: { __name: 'tasks' },
    taskSubtasks: { __name: 'task_subtasks' },
    taskTemplates: { __name: 'task_templates' },
    tracks: { __name: 'tracks', id: 'tracks.id', subscriptionId: 'tracks.subscription_id' },
    subscriptions: { id: 'subscriptions.id', orgId: 'subscriptions.org_id' },
    scheduleRows: { __name: 'schedule_rows', id: 'schedule_rows.id', scheduleId: 'schedule_rows.schedule_id' },
    projectSchedules: { id: 'project_schedules.id', orgId: 'project_schedules.org_id', dealId: 'project_schedules.deal_id' },
    deals: { id: 'deals.id', orgId: 'deals.org_id' },
  },
}))

vi.mock('drizzle-orm', async () => ({
  ...await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm'),
  eq: () => ({}),
}))

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
      from: (table: { __name: string }) => {
        const row = table.__name === 'tracks'
          ? (trackOrgId ? { orgId: trackOrgId } : null)
          : table.__name === 'schedule_rows'
            ? (scheduleOrgId ? { orgId: scheduleOrgId } : null)
            : template
        const query = {
          innerJoin: () => query,
          leftJoin: () => query,
          where: () => query,
          limit: async () => (row ? [row] : []),
        }
        return query
      },
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
    trackOrgId = null
    scheduleOrgId = null
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

  it('records the MCP actor as the creator while authorising as the service identity', async () => {
    authResult = {
      orgId: 'tahi-org',
      userId: 'api-service',
      mcpActor: { teamMemberId: 'tm_staci', clerkUserId: 'user_staci', profile: 'designer' },
    }
    try {
      const res = await POST(post({ templateId: 'tpl1' }) as never)
      expect(res.status).toBe(201)
      expect(inserted[0].values.createdById).toBe('user_staci')
    } finally {
      authResult = { orgId: 'tahi-org', userId: 'user_1' }
    }
  })

  it('records api-service when the service call carries no actor', async () => {
    authResult = { orgId: 'tahi-org', userId: 'api-service' }
    try {
      await POST(post({ templateId: 'tpl1' }) as never)
      expect(inserted[0].values.createdById).toBe('api-service')
    } finally {
      authResult = { orgId: 'tahi-org', userId: 'user_1' }
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

  it('says nothing when a service caller names itself as the actor', async () => {
    // The worker MCP authenticates as the service user, which is nobody's
    // login, so resolveTeamMember answers null and the self-check had nothing
    // to compare against: an MCP run that applied a template to the asker rang
    // the asker's own bell.
    callerTeamMemberId = null
    await POST(post({
      templateId: 'tpl1', assigneeId: 'tm_staci', actorTeamMemberId: 'tm_staci',
    }) as never)
    expect(notified).toHaveLength(0)
  })

  it('still tells the assignee when the stated actor is somebody else', async () => {
    callerTeamMemberId = null
    await POST(post({
      templateId: 'tpl1', assigneeId: 'tm_staci', actorTeamMemberId: 'tm_liam',
    }) as never)
    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({ recipient: { teamMemberId: 'tm_staci' } })
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

  it.each([
    { field: 'trackId', message: 'Track must belong to the task client' },
    { field: 'scheduleRowId', message: 'Schedule row must belong to the task client' },
  ])('rejects a foreign $field before any task or checklist writes', async ({ field, message }) => {
    template = { ...template, type: 'client_task' }
    trackOrgId = 'o2'
    scheduleOrgId = 'o2'
    const res = await POST(post({ templateId: 'tpl1', orgId: 'o1', assigneeId: 'tm_staci', [field]: 'foreign-id' }) as never)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: message })
    expect(inserted).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  it.each([
    { field: 'trackId', message: 'Track must belong to the task client' },
    { field: 'scheduleRowId', message: 'Schedule row must belong to the task client' },
  ])('rejects a missing $field without writing anything', async ({ field, message }) => {
    template = { ...template, type: 'client_task' }
    const res = await POST(post({ templateId: 'tpl1', orgId: 'o1', [field]: 'missing-id' }) as never)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: message })
    expect(inserted).toHaveLength(0)
  })

  it('stores same-client delivery links and the existing template fields', async () => {
    template = { ...template, type: 'client_task' }
    trackOrgId = 'o1'
    scheduleOrgId = 'o1'
    const res = await POST(post({
      templateId: 'tpl1', orgId: 'o1', trackId: 'track1', scheduleRowId: 'row1',
    }) as never)

    expect(res.status).toBe(201)
    expect(inserted[0].values).toMatchObject({
      orgId: 'o1', trackId: 'track1', scheduleRowId: 'row1', priority: 'standard', estimatedHours: 2,
    })
    expect(inserted.filter(row => row.table === 'task_subtasks').map(row => row.values.title)).toEqual(['Crawl', 'Report'])
  })

  it('does not attach a client track to an internal template that clears the client', async () => {
    trackOrgId = 'o1'
    const res = await POST(post({ templateId: 'tpl1', orgId: 'o1', trackId: 'track1' }) as never)

    expect(res.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })
})
