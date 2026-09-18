/**
 * The task-thread tools, as a pure map from tool call to dashboard API call.
 *
 * Same shape as ./request-tools: the mapping is a plain function, covered by
 * a spec in app/api/__tests__/mcp-task-comment-tool-parity.test.ts (vitest
 * excludes workers/**, so the spec lives inside app/ where the root run
 * already sweeps it). This module deliberately knows nothing about fetch,
 * tokens or the Workers runtime.
 */

import { coerceBoolean } from './coerce'

export type McpMethod = 'GET' | 'POST'

export interface McpApiCall {
  path: string
  method: McpMethod
  /** Present on writes only. */
  body?: Record<string, unknown>
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] ? String(args[key]) : undefined
}

/**
 * The dashboard call one task-thread tool maps to, or null when the name
 * belongs to another block of the switch.
 */
export function taskCommentToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  const s = (key: string) => str(args, key)

  switch (name) {
    case 'list_task_comments': {
      const taskId = s('task_id')
      if (!taskId) throw new Error('task_id is required')
      return { path: `/api/admin/tasks/${taskId}/comments`, method: 'GET' }
    }
    case 'post_task_comment': {
      const taskId = s('task_id')
      if (!taskId) throw new Error('task_id is required')
      const body = s('body')
      if (!body) throw new Error('body is required')
      // asBot is the field the route reads; the tool's public argument is
      // as_bot, so the mapping translates it the same way
      // post_request_message translates content -> body.
      const asBot = coerceBoolean(args.as_bot) ?? false
      return {
        path: `/api/admin/tasks/${taskId}/comments`,
        method: 'POST',
        body: { body, asBot },
      }
    }
    default:
      return null
  }
}
