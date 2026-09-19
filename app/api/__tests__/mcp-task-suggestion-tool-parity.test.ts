/**
 * The worker MCP call-suggestions tools, against the routes they call.
 *
 * Same reason app/api/__tests__/mcp-task-comment-tool-parity.test.ts exists:
 * the mapping is a pure function
 * (workers/mcp-server/src/task-suggestion-tools.ts) and the spec lives
 * here, inside app/, which the root vitest run already sweeps
 * (vitest.config.ts excludes workers/**).
 */
import { describe, it, expect } from 'vitest'
import { taskSuggestionToolCall } from '../../../workers/mcp-server/src/task-suggestion-tools'

function call(name: string, args: Record<string, unknown> = {}) {
  const mapped = taskSuggestionToolCall(name, args)
  if (!mapped) throw new Error(`${name} is not mapped`)
  return mapped
}

describe('list_task_suggestions', () => {
  it('reads the pending queue with no arguments', () => {
    const mapped = call('list_task_suggestions')
    expect(mapped.path).toBe('/api/admin/task-suggestions')
    expect(mapped.method).toBe('GET')
    expect(mapped.query).toEqual({})
  })

  it('carries status, call_id and limit through as query params', () => {
    const mapped = call('list_task_suggestions', { status: 'snoozed', call_id: 'c1', limit: '10' })
    expect(mapped.query).toEqual({ status: 'snoozed', callId: 'c1', limit: '10' })
  })
})

describe('decide_task_suggestion', () => {
  it('approves with no proposal override', () => {
    const mapped = call('decide_task_suggestion', { id: 's1', action: 'approve' })
    expect(mapped.path).toBe('/api/admin/task-suggestions/s1/decide')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ action: 'approve' })
  })

  it('approves with a proposal override (Tweak)', () => {
    const proposal = { title: 'Edited title' }
    const mapped = call('decide_task_suggestion', { id: 's1', action: 'approve', proposal })
    expect(mapped.body).toEqual({ action: 'approve', proposal })
  })

  it('rejects', () => {
    const mapped = call('decide_task_suggestion', { id: 's1', action: 'reject' })
    expect(mapped.body).toEqual({ action: 'reject' })
  })

  it('snoozes with a valid preset', () => {
    const mapped = call('decide_task_suggestion', { id: 's1', action: 'snooze', snooze: 'tonight' })
    expect(mapped.body).toEqual({ action: 'snooze', snooze: 'tonight' })

    const mapped2 = call('decide_task_suggestion', { id: 's1', action: 'snooze', snooze: 'this_week' })
    expect(mapped2.body).toEqual({ action: 'snooze', snooze: 'this_week' })
  })

  it('requires id and action', () => {
    expect(() => call('decide_task_suggestion', { action: 'approve' })).toThrow('id is required')
    expect(() => call('decide_task_suggestion', { id: 's1' })).toThrow('action is required')
  })

  it('rejects an unknown action', () => {
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'delete' }))
      .toThrow("action must be 'approve', 'reject' or 'snooze'")
  })

  it('rejects a snooze action with no preset, or an unknown one', () => {
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'snooze' }))
      .toThrow("snooze must be 'tonight' or 'this_week'")
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'snooze', snooze: 'next_month' }))
      .toThrow("snooze must be 'tonight' or 'this_week'")
  })

  it('ignores a proposal override on a reject or snooze', () => {
    const mapped = call('decide_task_suggestion', { id: 's1', action: 'reject', proposal: { title: 'x' } })
    expect(mapped.body).toEqual({ action: 'reject' })
  })
})

describe('rebuild_task_suggestions', () => {
  it('rebuilds the named transcripts', () => {
    const mapped = call('rebuild_task_suggestions', { transcript_ids: ['tr1', 'tr2'] })
    expect(mapped.path).toBe('/api/admin/task-suggestions/rebuild')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ transcriptIds: ['tr1', 'tr2'] })
  })

  it('rebuilds everything when asked to', () => {
    const mapped = call('rebuild_task_suggestions', { all: true })
    expect(mapped.body).toEqual({ all: true })
  })

  it('refuses a call that names nothing rather than rebuilding the workspace', () => {
    // The dangerous default: an empty call must never quietly become "all".
    expect(() => call('rebuild_task_suggestions', {})).toThrow('Name transcript_ids')
    expect(() => call('rebuild_task_suggestions', { transcript_ids: [] })).toThrow('Name transcript_ids')
    expect(() => call('rebuild_task_suggestions', { all: false })).toThrow('Name transcript_ids')
  })

  it('drops blank ids out of the list', () => {
    const mapped = call('rebuild_task_suggestions', { transcript_ids: ['tr1', '  ', 7] })
    expect(mapped.body).toEqual({ transcriptIds: ['tr1'] })
  })
})

describe('names outside this module', () => {
  it('returns null for an unrelated tool name', () => {
    expect(taskSuggestionToolCall('list_tasks', {})).toBeNull()
  })
})
