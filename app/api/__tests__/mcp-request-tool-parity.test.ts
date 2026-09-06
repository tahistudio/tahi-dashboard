/**
 * The worker MCP request tools, against the routes they call.
 *
 * `post_request_message` sent `content` while POST
 * /api/admin/requests/[id]/messages reads `body`, so every call 400d and
 * nothing caught it: the worker had no tests at all, and vitest.config.ts
 * excludes `workers/**`. The mapping is a pure function now
 * (workers/mcp-server/src/request-tools.ts) and the spec lives here, inside
 * app/, which the root vitest run already sweeps. The relative import is
 * deliberate: the `@/` alias resolves from the repo root and the worker sits
 * outside the Next app.
 */
import { describe, it, expect } from 'vitest'
import { requestToolCall } from '../../../workers/mcp-server/src/request-tools'

function call(name: string, args: Record<string, unknown> = {}) {
  const mapped = requestToolCall(name, args)
  if (!mapped) throw new Error(`${name} is not mapped`)
  return mapped
}

describe('post_request_message', () => {
  it('sends the text under `body`, the field the route reads', () => {
    const mapped = call('post_request_message', { requestId: 'r1', content: 'Shipped it' })
    expect(mapped.path).toBe('/api/admin/requests/r1/messages')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ body: 'Shipped it', isInternal: false })
    // The regression that shipped: `content` on the wire 400s every call.
    expect(mapped.body).not.toHaveProperty('content')
  })

  it('carries the internal flag through when it is set', () => {
    expect(call('post_request_message', { requestId: 'r1', content: 'x', isInternal: true }).body)
      .toEqual({ body: 'x', isInternal: true })
  })
})

describe('update_request_fields', () => {
  it('maps an empty string to null for every clearable field', () => {
    const mapped = call('update_request_fields', {
      requestId: 'r1', startDate: '', dueDate: '', trackId: '',
    })
    expect(mapped.method).toBe('PATCH')
    expect(mapped.body).toEqual({ startDate: null, dueDate: null, trackId: null })
  })

  it('maps 0 hours to null, since the schema cannot express it', () => {
    expect(call('update_request_fields', { requestId: 'r1', estimatedHours: 0 }).body)
      .toEqual({ estimatedHours: null })
  })

  it('keeps real values intact', () => {
    expect(call('update_request_fields', {
      requestId: 'r1',
      startDate: '2026-09-01',
      dueDate: '2026-09-10',
      estimatedHours: 6,
      trackId: 'track_1',
      checklists: '[]',
      isInternal: true,
      category: 'design',
      priority: 'high',
    }).body).toEqual({
      category: 'design',
      priority: 'high',
      startDate: '2026-09-01',
      dueDate: '2026-09-10',
      estimatedHours: 6,
      trackId: 'track_1',
      checklists: '[]',
      isInternal: true,
    })
  })

  it('refuses an empty patch rather than PATCHing nothing', () => {
    expect(() => requestToolCall('update_request_fields', { requestId: 'r1' })).toThrow(/at least one/i)
  })

  it('lets isInternal false through: it is how a request goes client-visible again', () => {
    expect(call('update_request_fields', { requestId: 'r1', isInternal: false }).body)
      .toEqual({ isInternal: false })
  })
})

describe('request reads', () => {
  it('routes the list read with the query names the route reads', () => {
    const mapped = call('list_requests', { status: 'in_progress', clientId: 'org_1', limit: '50' })
    expect(mapped).toEqual({
      path: '/api/admin/requests',
      method: 'GET',
      query: { status: 'in_progress', orgId: 'org_1', limit: '50' },
    })
  })

  it('reads steps, time entries and files off the request itself', () => {
    expect(call('get_request_steps', { requestId: 'r1' }).path).toBe('/api/admin/requests/r1/steps')
    expect(call('list_request_time_entries', { requestId: 'r1' }).path)
      .toBe('/api/admin/requests/r1/time-entries')
    expect(call('list_request_files', { requestId: 'r1' }).path).toBe('/api/admin/requests/r1/files')
  })
})

describe('request steps', () => {
  it('posts a new step under the request', () => {
    const mapped = call('create_request_step', { requestId: 'r1', title: 'Wireframes' })
    expect(mapped.path).toBe('/api/admin/requests/r1/steps')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toMatchObject({ title: 'Wireframes' })
  })

  it('lifts a step to the top level when the parent is cleared', () => {
    expect(call('update_request_step', { requestId: 'r1', stepId: 's1', parentStepId: '' }).body)
      .toEqual({ parentStepId: null })
  })

  it('deletes through the nested path', () => {
    const mapped = call('delete_request_step', { requestId: 'r1', stepId: 's1' })
    expect(mapped.path).toBe('/api/admin/requests/r1/steps/s1')
    expect(mapped.method).toBe('DELETE')
  })
})

describe('time logging', () => {
  it('defaults billable to true, the way the detail rail does', () => {
    expect(call('log_request_time', { requestId: 'r1', hours: 2 }).body)
      .toMatchObject({ hours: 2, billable: true })
  })

  it('respects an explicit non-billable entry', () => {
    expect(call('log_request_time', { requestId: 'r1', hours: 2, billable: false }).body)
      .toMatchObject({ billable: false })
  })

  it('passes an explicit rate through, including a deliberate zero', () => {
    expect(call('log_request_time', { requestId: 'r1', hours: 2, hourlyRate: 210 }).body)
      .toMatchObject({ hourlyRate: 210 })
    expect(call('log_request_time', { requestId: 'r1', hours: 2, hourlyRate: 0 }).body)
      .toMatchObject({ hourlyRate: 0 })
  })

  it('sends no rate at all when none was given, so the client default applies', () => {
    // Not null and not 0: either would be a decision the caller did not make,
    // and 0 bills the hours at nothing.
    expect(call('log_request_time', { requestId: 'r1', hours: 2 }).body?.hourlyRate)
      .toBeUndefined()
  })
})

describe('kanban columns', () => {
  it('reads the global board with no org', () => {
    expect(call('list_kanban_columns')).toEqual({
      path: '/api/admin/kanban-columns', method: 'GET', query: {},
    })
  })

  it('reads one client board when an org is named', () => {
    expect(call('list_kanban_columns', { orgId: 'org_1' }).query).toEqual({ orgId: 'org_1' })
  })

  it('keeps columnId out of the patch body', () => {
    const mapped = call('update_kanban_column', { columnId: 'col_1', label: 'In Review' })
    expect(mapped.path).toBe('/api/admin/kanban-columns/col_1')
    expect(mapped.body).toEqual({ label: 'In Review' })
  })

  it('refuses an update with no column id', () => {
    expect(() => requestToolCall('update_kanban_column', { label: 'x' })).toThrow(/columnId/)
  })
})

describe('AI on one request', () => {
  it('posts to triage and draft-reply without a body of its own', () => {
    expect(call('ai_triage_request', { requestId: 'r1' })).toEqual({
      path: '/api/admin/requests/r1/triage', method: 'POST', body: {},
    })
    expect(call('ai_draft_request_reply', { requestId: 'r1' })).toEqual({
      path: '/api/admin/requests/r1/draft-reply', method: 'POST', body: {},
    })
  })
})

describe('predict_entry_fields', () => {
  it('posts the arguments straight to the prediction route', () => {
    const mapped = call('predict_entry_fields', {
      subject: 'request',
      title: 'Rebuild the pricing page hero for the launch',
      orgId: 'org_1',
      empty: ['dueDate', 'priority'],
      todayIso: '2026-09-05',
    })
    expect(mapped.path).toBe('/api/admin/ai/predict-fields')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({
      subject: 'request',
      title: 'Rebuild the pricing page hero for the launch',
      orgId: 'org_1',
      empty: ['dueDate', 'priority'],
      todayIso: '2026-09-05',
    })
  })

  it('takes a task with a level and no client', () => {
    expect(call('predict_entry_fields', {
      subject: 'task',
      title: 'Write the quarterly capacity review',
      level: 'tahi_internal',
    }).body).toMatchObject({ subject: 'task', level: 'tahi_internal' })
  })

  it('refuses a subject outside the two the route accepts', () => {
    expect(() => requestToolCall('predict_entry_fields', { subject: 'invoice', title: 'x y z abcd' }))
      .toThrow(/subject/)
  })

  it('refuses a call with no title, rather than 400ing at the route', () => {
    expect(() => requestToolCall('predict_entry_fields', { subject: 'request' })).toThrow(/title/)
  })
})

describe('tools held back', () => {
  it('exposes no bulk request tool while /api/admin/requests/bulk is unscoped', () => {
    // The bulk route gates on isTahiAdmin alone, loops arbitrary ids with no
    // per-row requireAccessToOrg and writes `status` against no vocabulary.
    // These names come back only with that route's fix.
    expect(requestToolCall('bulk_update_request_status', { requestIds: ['r1'] })).toBeNull()
    expect(requestToolCall('bulk_create_requests', { orgIds: ['o1'], title: 't' })).toBeNull()
  })

  it('claims no tool name outside the request surface', () => {
    expect(requestToolCall('list_tasks', {})).toBeNull()
    expect(requestToolCall('list_clients', {})).toBeNull()
    expect(requestToolCall('ai_request_wizard', {})).toBeNull()
  })

  it('exposes no tool for the deleted ai/suggest route', () => {
    // app/api/admin/ai/suggest was admin-authed keyword heuristics with zero
    // callers that emitted an `urgent` priority a request cannot store. Its
    // replacement is predict_entry_fields; the old name must never resolve.
    expect(requestToolCall('ai_suggest', {})).toBeNull()
  })
})
