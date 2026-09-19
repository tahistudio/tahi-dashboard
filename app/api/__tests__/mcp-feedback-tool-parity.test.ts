/**
 * The worker MCP feedback tools, against the route they call.
 *
 * Same reason app/api/__tests__/mcp-task-comment-tool-parity.test.ts exists:
 * the mapping is a pure function (workers/mcp-server/src/feedback-tools.ts)
 * and the spec lives here, inside app/, which the root vitest run already
 * sweeps (vitest.config.ts excludes workers/**).
 */
import { describe, it, expect } from 'vitest'
import { feedbackToolCall } from '../../../workers/mcp-server/src/feedback-tools'

function call(name: string, args: Record<string, unknown> = {}) {
  const mapped = feedbackToolCall(name, args)
  if (!mapped) throw new Error(`${name} is not mapped`)
  return mapped
}

describe('delete_feedback_comment', () => {
  it('deletes the comment by id', () => {
    const mapped = call('delete_feedback_comment', { id: 'fb_1' })
    expect(mapped.path).toBe('/api/admin/feedback/fb_1')
    expect(mapped.method).toBe('DELETE')
  })

  it('requires id', () => {
    expect(() => call('delete_feedback_comment', {})).toThrow('id is required')
  })
})

describe('feedbackToolCall', () => {
  it('returns null for a name it does not own', () => {
    expect(feedbackToolCall('list_feedback_comments', {})).toBeNull()
  })
})
