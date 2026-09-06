/**
 * The request-surface tools, as a pure map from tool call to dashboard API call.
 *
 * This used to be a run of `case` arms inside executeTool, which meant the one
 * thing that can silently break, the field name on the wire, had no test at
 * all: `post_request_message` sent `content` for months while the route reads
 * `body`, so every call 400d and nothing caught it. vitest.config.ts excludes
 * `workers/**`, so the arms could not be covered where they sat. Split out
 * here, the mapping is a plain function and the spec lives in
 * app/api/__tests__/mcp-request-tool-parity.test.ts, which the root vitest run
 * already picks up.
 *
 * The module deliberately knows nothing about fetch, tokens or the Workers
 * runtime. index.ts asks it what to call and does the calling.
 *
 * Portal parity note: the client-side request capabilities (portal create with
 * placement, portal review approve / request changes, portal capacity read)
 * have no tools here on purpose. The worker authenticates with the service
 * token, which lib/server-auth.ts resolves to the Tahi admin org, and every
 * /api/portal route 403s that org. They are unreachable from this server until
 * a portal impersonation token exists, not merely unwritten.
 */

export type McpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface McpApiCall {
  path: string
  method: McpMethod
  /** Present on writes only. */
  body?: Record<string, unknown>
  /** Present on reads only. Empty values are dropped by the fetch helper. */
  query?: Record<string, string>
}

/** Matches executeTool's own reader: absent, '' and 0 all read as undefined. */
function str(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] ? String(args[key]) : undefined
}

/**
 * The dashboard call one request-surface tool maps to, or null when the name
 * belongs to another block of the switch.
 *
 * Throws rather than returning a half-built call when the arguments cannot
 * produce a meaningful request, so the model gets a usable message instead of
 * a 400 from the route.
 */
export function requestToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  const s = (key: string) => str(args, key)

  switch (name) {
    // ── Reads ─────────────────────────────────────────────────────────
    case 'list_requests': {
      const query: Record<string, string> = {}
      if (s('status')) query.status = s('status')!
      if (s('clientId')) query.orgId = s('clientId')!
      if (s('limit')) query.limit = s('limit')!
      if (s('page')) query.page = s('page')!
      return { path: '/api/admin/requests', method: 'GET', query }
    }
    case 'get_request':
      return { path: `/api/admin/requests/${s('requestId')}`, method: 'GET' }
    case 'get_request_messages':
      return { path: `/api/admin/requests/${s('requestId')}/messages`, method: 'GET' }
    case 'get_request_steps':
      return { path: `/api/admin/requests/${s('requestId')}/steps`, method: 'GET' }

    // ── Writes on the request itself ──────────────────────────────────
    case 'create_request':
      return { path: '/api/admin/requests', method: 'POST', body: { ...args } }
    case 'update_request_status':
      return {
        path: `/api/admin/requests/${s('requestId')}`,
        method: 'PATCH',
        body: { status: s('status') },
      }
    case 'assign_request':
      return {
        path: `/api/admin/requests/${s('requestId')}`,
        method: 'PATCH',
        body: { assigneeId: s('assigneeId') },
      }
    case 'link_request_to_schedule_row':
      return {
        path: `/api/admin/requests/${s('requestId')}`,
        method: 'PATCH',
        body: {
          scheduleRowId:
            typeof args.scheduleRowId === 'string' && args.scheduleRowId ? args.scheduleRowId : null,
        },
      }
    case 'delete_request':
      return { path: `/api/admin/requests/${s('requestId')}`, method: 'DELETE', body: {} }
    case 'duplicate_request':
      return { path: `/api/admin/requests/${s('requestId')}/duplicate`, method: 'POST', body: {} }
    case 'update_request_fields': {
      const patch: Record<string, unknown> = {}
      if (s('category')) patch.category = s('category')
      if (s('priority')) patch.priority = s('priority')
      // '' clears the date (the tool schema cannot express null).
      if (typeof args.startDate === 'string') patch.startDate = args.startDate || null
      if (typeof args.dueDate === 'string') patch.dueDate = args.dueDate || null
      // 0 clears the estimate for the same reason.
      if (typeof args.estimatedHours === 'number') patch.estimatedHours = args.estimatedHours || null
      // '' unlinks the capacity track.
      if (typeof args.trackId === 'string') patch.trackId = args.trackId || null
      // Checklists travel as a JSON string, the shape the detail rail PATCHes.
      if (typeof args.checklists === 'string') patch.checklists = args.checklists
      // Client visibility: true removes the request from the client portal.
      if (typeof args.isInternal === 'boolean') patch.isInternal = args.isInternal
      if (Object.keys(patch).length === 0) throw new Error('Pass at least one field to update')
      return { path: `/api/admin/requests/${s('requestId')}`, method: 'PATCH', body: patch }
    }
    case 'post_request_message':
      // The route reads `body`, not `content`. The tool keeps `content` as its
      // public argument name and translates here; sending `content` on the wire
      // 400d every call with "Message body or at least one attachment is required".
      return {
        path: `/api/admin/requests/${s('requestId')}/messages`,
        method: 'POST',
        body: { body: s('content'), isInternal: args.isInternal ?? false },
      }

    // ── Workflow steps ────────────────────────────────────────────────
    case 'create_request_step':
      return {
        path: `/api/admin/requests/${s('requestId')}/steps`,
        method: 'POST',
        body: {
          title: s('title'),
          description: s('description'),
          parentStepId: s('parentStepId'),
          orderIndex: typeof args.orderIndex === 'number' ? args.orderIndex : undefined,
        },
      }
    case 'update_request_step': {
      const patch: Record<string, unknown> = {}
      if (s('title')) patch.title = s('title')
      if (typeof args.description === 'string') patch.description = args.description || null
      if (typeof args.completed === 'boolean') patch.completed = args.completed
      if (typeof args.orderIndex === 'number') patch.orderIndex = args.orderIndex
      // '' lifts the step to the top level.
      if (typeof args.parentStepId === 'string') patch.parentStepId = args.parentStepId || null
      if (typeof args.assigneeId === 'string') patch.assigneeId = args.assigneeId || null
      if (Object.keys(patch).length === 0) throw new Error('Pass at least one field to update')
      return {
        path: `/api/admin/requests/${s('requestId')}/steps/${s('stepId')}`,
        method: 'PATCH',
        body: patch,
      }
    }
    case 'delete_request_step':
      return {
        path: `/api/admin/requests/${s('requestId')}/steps/${s('stepId')}`,
        method: 'DELETE',
        body: {},
      }

    // ── Time and files ────────────────────────────────────────────────
    case 'list_request_time_entries':
      return { path: `/api/admin/requests/${s('requestId')}/time-entries`, method: 'GET' }
    case 'log_request_time':
      return {
        path: `/api/admin/requests/${s('requestId')}/time-entries`,
        method: 'POST',
        body: {
          hours: args.hours,
          description: s('description'),
          billable: args.billable ?? true,
          teamMemberId: s('teamMemberId'),
          // Omitted leaves the route on its own rule: the client's
          // default_hourly_rate, else no rate. Sending undefined here is not
          // the same as sending 0, which would bill the hours at nothing.
          hourlyRate: typeof args.hourlyRate === 'number' ? args.hourlyRate : undefined,
        },
      }
    case 'list_request_files':
      return { path: `/api/admin/requests/${s('requestId')}/files`, method: 'GET' }

    // ── Kanban columns ────────────────────────────────────────────────
    case 'list_kanban_columns': {
      const query: Record<string, string> = {}
      if (s('orgId')) query.orgId = s('orgId')!
      return { path: '/api/admin/kanban-columns', method: 'GET', query }
    }
    case 'create_kanban_column':
      return { path: '/api/admin/kanban-columns', method: 'POST', body: { ...args } }
    case 'update_kanban_column': {
      const { columnId, ...patch } = args
      if (!columnId) throw new Error('columnId is required')
      return { path: `/api/admin/kanban-columns/${columnId}`, method: 'PATCH', body: patch }
    }
    case 'delete_kanban_column':
      return { path: `/api/admin/kanban-columns/${s('columnId')}`, method: 'DELETE', body: {} }

    // ── AI on one request ─────────────────────────────────────────────
    case 'ai_triage_request':
      return { path: `/api/admin/requests/${s('requestId')}/triage`, method: 'POST', body: {} }
    case 'ai_draft_request_reply':
      return { path: `/api/admin/requests/${s('requestId')}/draft-reply`, method: 'POST', body: {} }

    // ── AI before a record exists ─────────────────────────────────────
    // The only tool here that names no requestId, because the thing it
    // predicts for has not been created yet. The route answers 200 with an
    // empty object rather than an error when there is too little to go on, so
    // the mapping passes the arguments through unchanged and lets the route's
    // own gate decide.
    case 'predict_entry_fields': {
      const subject = s('subject')
      if (subject !== 'request' && subject !== 'task') {
        throw new Error('subject must be "request" or "task"')
      }
      if (!s('title')) throw new Error('title is required')
      return { path: '/api/admin/ai/predict-fields', method: 'POST', body: { ...args, subject } }
    }

    default:
      return null
  }
}
