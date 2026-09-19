/**
 * The call-suggestions inbox tools, as a pure map from tool call to
 * dashboard API call. Same shape as ./task-comment-tools: covered by a spec
 * in app/api/__tests__/mcp-task-suggestion-tool-parity.test.ts (vitest
 * excludes workers/**, so the spec lives inside app/ where the root run
 * already sweeps it). This module deliberately knows nothing about fetch,
 * tokens or the Workers runtime.
 *
 * Backs GET /api/admin/task-suggestions, POST
 * /api/admin/task-suggestions/[id]/decide (CN.1 build contract, section 3)
 * and POST /api/admin/task-suggestions/rebuild (CN.1b, section 3). The decide
 * mapping also carries CN.1d's duplicate guard: the `attach` action, and
 * `force` on an approve the guard would otherwise refuse.
 */

export type McpMethod = 'GET' | 'POST'

export interface McpApiCall {
  path: string
  method: McpMethod
  /** Present on writes only. */
  body?: Record<string, unknown>
  /** Present on reads only. */
  query?: Record<string, string>
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] ? String(args[key]) : undefined
}

const DECIDE_ACTIONS = new Set(['approve', 'reject', 'snooze', 'attach'])
const SNOOZE_PRESETS = new Set(['tonight', 'this_week'])
const TARGET_KINDS = new Set(['request', 'task'])

/**
 * The dashboard call one suggestions-inbox tool maps to, or null when the
 * name belongs to another block of the switch.
 */
export function taskSuggestionToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  const s = (key: string) => str(args, key)

  switch (name) {
    case 'list_task_suggestions': {
      const query: Record<string, string> = {}
      const status = s('status')
      if (status) query.status = status
      const callId = s('call_id')
      if (callId) query.callId = callId
      const limit = s('limit')
      if (limit) query.limit = limit
      return { path: '/api/admin/task-suggestions', method: 'GET', query }
    }
    case 'decide_task_suggestion': {
      const id = s('id')
      if (!id) throw new Error('id is required')
      const action = s('action')
      if (!action) throw new Error('action is required')
      if (!DECIDE_ACTIONS.has(action)) {
        throw new Error("action must be 'approve', 'reject', 'snooze' or 'attach'")
      }
      const body: Record<string, unknown> = { action }
      if (action === 'approve' && args.proposal !== undefined) {
        body.proposal = args.proposal
      }
      // Only ever sent when it is true. An approve carrying `force: false` and
      // one carrying nothing are the same decision, and an assistant that
      // passes force along by habit would quietly disarm the duplicate guard.
      if (action === 'approve' && args.force === true) {
        body.force = true
      }
      if (action === 'attach') {
        const kind = s('target_kind')
        const targetId = s('target_id')
        if (!kind || !TARGET_KINDS.has(kind)) {
          throw new Error("target_kind must be 'request' or 'task'")
        }
        if (!targetId) throw new Error('target_id is required for an attach')
        body.target = { kind, id: targetId }
      }
      if (action === 'snooze') {
        const snooze = s('snooze')
        if (!snooze || !SNOOZE_PRESETS.has(snooze)) {
          throw new Error("snooze must be 'tonight' or 'this_week'")
        }
        body.snooze = snooze
      }
      return { path: `/api/admin/task-suggestions/${id}/decide`, method: 'POST', body }
    }
    case 'rebuild_task_suggestions': {
      // Either a named list or the whole workspace, never neither: the route
      // 400s an empty call rather than guessing, and the tool should not
      // invent an `all: true` the asker did not say.
      const body: Record<string, unknown> = {}
      const ids = args.transcript_ids
      if (Array.isArray(ids)) {
        const named = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        if (named.length > 0) body.transcriptIds = named
      }
      if (args.all === true) body.all = true
      if (body.transcriptIds === undefined && body.all === undefined) {
        throw new Error('Name transcript_ids, or pass all true')
      }
      return { path: '/api/admin/task-suggestions/rebuild', method: 'POST', body }
    }
    default:
      return null
  }
}
