/**
 * The feedback-comment write tools, as a pure map from tool call to
 * dashboard API call. Same shape as ./task-comment-tools: the mapping is a
 * plain function, covered by a spec in
 * app/api/__tests__/mcp-feedback-tool-parity.test.ts (vitest excludes
 * workers/**, so the spec lives inside app/ where the root run already
 * sweeps it). list_feedback_comments itself stays a plain GET handled
 * inline in index.ts; this module covers the write side only.
 */

export type McpMethod = 'DELETE'

export interface McpApiCall {
  path: string
  method: McpMethod
  body?: Record<string, unknown>
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] ? String(args[key]) : undefined
}

/**
 * The dashboard call one feedback tool maps to, or null when the name
 * belongs to another block of the switch.
 */
export function feedbackToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  const s = (key: string) => str(args, key)

  switch (name) {
    case 'delete_feedback_comment': {
      const id = s('id')
      if (!id) throw new Error('id is required')
      return { path: `/api/admin/feedback/${id}`, method: 'DELETE', body: {} }
    }
    default:
      return null
  }
}
