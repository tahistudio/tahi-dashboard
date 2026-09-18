/**
 * The worker MCP task-comment tools, against the route they call.
 *
 * Same reason app/api/__tests__/mcp-request-tool-parity.test.ts exists: the
 * mapping is a pure function (workers/mcp-server/src/task-comment-tools.ts)
 * and the spec lives here, inside app/, which the root vitest run already
 * sweeps (vitest.config.ts excludes workers/**).
 */
import { describe, it, expect } from 'vitest'
import { taskCommentToolCall } from '../../../workers/mcp-server/src/task-comment-tools'

function call(name: string, args: Record<string, unknown> = {}) {
  const mapped = taskCommentToolCall(name, args)
  if (!mapped) throw new Error(`${name} is not mapped`)
  return mapped
}

describe('list_task_comments', () => {
  it('reads the task thread', () => {
    const mapped = call('list_task_comments', { task_id: 't1' })
    expect(mapped.path).toBe('/api/admin/tasks/t1/comments')
    expect(mapped.method).toBe('GET')
  })

  it('requires task_id', () => {
    expect(() => call('list_task_comments', {})).toThrow('task_id is required')
  })
})

describe('post_task_comment', () => {
  it('posts as a person by default, asBot false', () => {
    const mapped = call('post_task_comment', { task_id: 't1', body: 'Following up' })
    expect(mapped.path).toBe('/api/admin/tasks/t1/comments')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ body: 'Following up', asBot: false })
  })

  it('translates as_bot to the asBot field the route reads', () => {
    const mapped = call('post_task_comment', { task_id: 't1', body: 'The call said this is done', as_bot: true })
    expect(mapped.body).toEqual({ body: 'The call said this is done', asBot: true })
    // The regression class the request-tools parity spec exists to catch:
    // the public argument name must never leak onto the wire unmapped.
    expect(mapped.body).not.toHaveProperty('as_bot')
  })

  it('reads a stringly "true" the way every other coerced boolean tool does', () => {
    const mapped = call('post_task_comment', { task_id: 't1', body: 'x', as_bot: 'true' })
    expect(mapped.body).toEqual({ body: 'x', asBot: true })
  })

  it('requires task_id and body', () => {
    expect(() => call('post_task_comment', { body: 'x' })).toThrow('task_id is required')
    expect(() => call('post_task_comment', { task_id: 't1' })).toThrow('body is required')
  })
})
