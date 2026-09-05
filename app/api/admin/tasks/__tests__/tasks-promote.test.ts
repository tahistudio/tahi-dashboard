/**
 * POST /api/admin/tasks/[id]/promote.
 *
 * Promotion is the one place a task becomes client-facing work, so it is the
 * one place three things have to be true at once: the request is written the
 * way POST /api/admin/requests writes one (atomic per-org number, both the
 * legacy `type` and the modern `size`, the domain event), the task is linked
 * and lifted to Client level, and a task's `urgent` is clamped to a request's
 * `high` rather than writing a priority the requests surface cannot render.
 *
 * The `sql` tag is replaced with a recorder so the test can read the column
 * order and the bound values without a database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type TaskRow = {
  id: string
  orgId: string | null
  title: string
  description: string | null
  priority: string
  assigneeId: string | null
  dueDate: string | null
  estimatedHours: number | null
  requestId: string | null
}

const runs: { text: string; values: unknown[] }[] = []
const updates: Record<string, unknown>[] = []
const events: Record<string, unknown>[] = []
let taskRow: TaskRow | null = null

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({ schema: { tasks: { id: 'id', orgId: 'org_id' } } }))

vi.mock('@/lib/task-access', () => ({ guardTask: async () => null }))

vi.mock('@/lib/request-status-effects', () => ({
  emitRequestCreated: async (_db: unknown, subject: Record<string, unknown>) => {
    events.push(subject)
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join('?'),
      values,
    }),
  }
})

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (taskRow ? [taskRow] : []) }),
      }),
    }),
    run: async (query: { text: string; values: unknown[] }) => { runs.push(query) },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push(values) },
      }),
    }),
  }),
}))

const { POST } = await import('../[id]/promote/route')

function promote(body: unknown = {}): Request {
  return new Request('http://localhost/api/admin/tasks/t1/promote', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 't1' }) }

// The bound values, in the order the INSERT interpolates them.
const V = {
  requestId: 0, orgId: 1, title: 2, legacyType: 3, size: 4, category: 5,
  description: 6, priority: 7, assigneeId: 8, dueDate: 9, estimatedHours: 10,
  submittedById: 11,
} as const

function boundValues(): unknown[] {
  expect(runs).toHaveLength(1)
  return runs[0].values
}

beforeEach(() => {
  runs.length = 0
  updates.length = 0
  events.length = 0
  taskRow = {
    id: 't1',
    orgId: 'o1',
    title: 'Rebuild the pricing page',
    description: 'Two sections',
    priority: 'standard',
    assigneeId: 'tm1',
    dueDate: '2026-09-09',
    estimatedHours: 3.5,
    requestId: null,
  }
})

describe('POST /api/admin/tasks/[id]/promote', () => {
  it('writes the request with the task fields and the caller category and size', async () => {
    const res = await POST(promote({ category: 'development', size: 'large_task' }) as never, params)
    expect(res.status).toBe(201)

    const values = boundValues()
    expect(runs[0].text).toContain('INSERT INTO requests')
    expect(values[V.orgId]).toBe('o1')
    expect(values[V.title]).toBe('Rebuild the pricing page')
    expect(values[V.category]).toBe('development')
    expect(values[V.description]).toBe('Two sections')
    expect(values[V.assigneeId]).toBe('tm1')
    expect(values[V.dueDate]).toBe('2026-09-09')
    expect(values[V.submittedById]).toBe('user_1')
  })

  it('carries the estimate across, since promotion is not a reason to lose it', async () => {
    await POST(promote() as never, params)
    expect(runs[0].text).toContain('estimated_hours')
    expect(boundValues()[V.estimatedHours]).toBe(3.5)

    runs.length = 0
    taskRow = { ...taskRow!, estimatedHours: null }
    await POST(promote() as never, params)
    expect(boundValues()[V.estimatedHours]).toBeNull()
  })

  it('holds the category to the vocabulary the requests surface filters on', async () => {
    const res = await POST(promote({ category: 'seo' }) as never, params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid category' })
    expect(runs).toHaveLength(0)
  })

  it('writes both the legacy type and the modern size', async () => {
    await POST(promote({ size: 'large_task' }) as never, params)
    expect(boundValues()[V.legacyType]).toBe('large_task')
    expect(runs[0].values[V.size]).toBe('large')

    runs.length = 0
    await POST(promote({}) as never, params)
    expect(boundValues()[V.legacyType]).toBe('small_task')
    expect(runs[0].values[V.size]).toBe('small')
  })

  it('assigns the request number atomically and scopes it to the org', async () => {
    await POST(promote() as never, params)
    expect(runs[0].text).toContain('COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ?), 0) + 1')
  })

  it('clamps an urgent task to a high request', async () => {
    taskRow = { ...taskRow!, priority: 'urgent' }
    await POST(promote() as never, params)
    expect(boundValues()[V.priority]).toBe('high')
  })

  it('leaves a standard task standard', async () => {
    await POST(promote() as never, params)
    expect(boundValues()[V.priority]).toBe('standard')
  })

  it('links the task and lifts it to Client level', async () => {
    const res = await POST(promote() as never, params)
    const json = await res.json() as { requestId: string }
    expect(updates).toHaveLength(1)
    expect(updates[0].requestId).toBe(json.requestId)
    expect(updates[0].type).toBe('client_task')
  })

  it('fires request_created so automations and webhooks see it', async () => {
    await POST(promote({ category: 'content' }) as never, params)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      orgId: 'o1',
      title: 'Rebuild the pricing page',
      type: 'small_task',
      category: 'content',
      status: 'submitted',
      isInternal: false,
      source: 'admin',
    })
  })

  it('refuses a task with no client', async () => {
    taskRow = { ...taskRow!, orgId: null }
    const res = await POST(promote() as never, params)
    expect(res.status).toBe(400)
    expect(runs).toHaveLength(0)
  })

  it('refuses a task that already has a request', async () => {
    taskRow = { ...taskRow!, requestId: 'r_existing' }
    const res = await POST(promote() as never, params)
    expect(res.status).toBe(409)
    expect(runs).toHaveLength(0)
  })

  it('404s a task that does not exist', async () => {
    taskRow = null
    const res = await POST(promote() as never, params)
    expect(res.status).toBe(404)
    expect(runs).toHaveLength(0)
  })
})
