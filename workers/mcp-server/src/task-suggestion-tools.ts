/**
 * The call-suggestions inbox tools, as a pure map from tool call to
 * dashboard API call. Same shape as ./task-comment-tools: covered by a spec
 * in app/api/__tests__/mcp-task-suggestion-tool-parity.test.ts (vitest
 * excludes workers/**, so the spec lives inside app/ where the root run
 * already sweeps it). This module deliberately knows nothing about fetch,
 * tokens or the Workers runtime.
 *
 * Backs GET /api/admin/task-suggestions and POST
 * /api/admin/task-suggestions/[id]/decide (CN.1 build contract, section 3;
 * slice S1 owns both routes).
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

const DECIDE_ACTIONS = new Set(['approve', 'reject', 'snooze'])
const SNOOZE_PRESETS = new Set(['tonight', 'this_week'])

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
        throw new Error("action must be 'approve', 'reject' or 'snooze'")
      }
      const body: Record<string, unknown> = { action }
      if (action === 'approve' && args.proposal !== undefined) {
        body.proposal = args.proposal
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
    default:
      return null
  }
}
