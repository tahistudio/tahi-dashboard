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
import { TOOLS } from '../../../workers/mcp-server/src/index'

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
      .toThrow("action must be 'approve', 'reject', 'snooze' or 'attach'")
  })

  it('forces an approve past the duplicate guard only when asked to', () => {
    const forced = call('decide_task_suggestion', { id: 's1', action: 'approve', force: true })
    expect(forced.body).toEqual({ action: 'approve', force: true })

    // Anything but a literal true is the absence of force. An assistant that
    // passed `force: 'no'` along must not disarm the guard.
    expect(call('decide_task_suggestion', { id: 's1', action: 'approve', force: false }).body)
      .toEqual({ action: 'approve' })
    expect(call('decide_task_suggestion', { id: 's1', action: 'approve', force: 'yes' }).body)
      .toEqual({ action: 'approve' })
  })

  it('never carries force on anything but an approve', () => {
    expect(call('decide_task_suggestion', { id: 's1', action: 'reject', force: true }).body)
      .toEqual({ action: 'reject' })
  })

  it('attaches a create suggestion to a request or a task', () => {
    const toRequest = call('decide_task_suggestion', { id: 's1', action: 'attach', target_kind: 'request', target_id: 'r1' })
    expect(toRequest.path).toBe('/api/admin/task-suggestions/s1/decide')
    expect(toRequest.body).toEqual({ action: 'attach', target: { kind: 'request', id: 'r1' } })

    const toTask = call('decide_task_suggestion', { id: 's1', action: 'attach', target_kind: 'task', target_id: 't1' })
    expect(toTask.body).toEqual({ action: 'attach', target: { kind: 'task', id: 't1' } })
  })

  it('refuses an attach that names nothing to attach to', () => {
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'attach', target_id: 'r1' }))
      .toThrow("target_kind must be 'request' or 'task'")
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'attach', target_kind: 'invoice', target_id: 'i1' }))
      .toThrow("target_kind must be 'request' or 'task'")
    expect(() => call('decide_task_suggestion', { id: 's1', action: 'attach', target_kind: 'request' }))
      .toThrow('target_id is required')
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

  // CN.1c. A rebuild adds to the inbox by default; each switch travels only
  // when it leaves its default, so a habit cannot expire anybody's inbox.
  it('carries replace only when it is a literal true', () => {
    expect(call('rebuild_task_suggestions', { all: true, replace: true }).body).toEqual({ all: true, replace: true })
    expect(call('rebuild_task_suggestions', { all: true, replace: 'yes' }).body).toEqual({ all: true })
    expect(call('rebuild_task_suggestions', { all: true, replace: false }).body).toEqual({ all: true })
  })

  it('switches the second read and the immediate read off only on a literal false', () => {
    expect(call('rebuild_task_suggestions', { transcript_ids: ['tr1'], second_pass: false, read_now: false }).body)
      .toEqual({ transcriptIds: ['tr1'], secondPass: false, readNow: false })
    expect(call('rebuild_task_suggestions', { transcript_ids: ['tr1'], second_pass: true, read_now: 'no' }).body)
      .toEqual({ transcriptIds: ['tr1'] })
  })
})

describe('cron_suggest_from_transcripts', () => {
  it('fires the sweep with the scheduled defaults', () => {
    const mapped = call('cron_suggest_from_transcripts')
    expect(mapped).toEqual({ path: '/api/admin/crons/suggest-from-transcripts', method: 'POST', body: {} })
  })

  it('puts limit and second_pass in the query, where the route reads them', () => {
    expect(call('cron_suggest_from_transcripts', { limit: 12, second_pass: false }).path)
      .toBe('/api/admin/crons/suggest-from-transcripts?limit=12&second_pass=0')
    expect(call('cron_suggest_from_transcripts', { second_pass: true }).path)
      .toBe('/api/admin/crons/suggest-from-transcripts')
  })
})

describe('names outside this module', () => {
  it('returns null for an unrelated tool name', () => {
    expect(taskSuggestionToolCall('list_tasks', {})).toBeNull()
  })
})

describe('the registered tool descriptions list the CN.1b request kinds', () => {
  const REQUEST_KINDS = ['create_request', 'update_request', 'request_note', 'hand_off_request']

  function description(name: string): string {
    const tool = TOOLS.find(t => t.name === name)
    if (!tool) throw new Error(`${name} is not registered`)
    return tool.description
  }

  it('list_task_suggestions names every request kind', () => {
    const desc = description('list_task_suggestions')
    for (const kind of REQUEST_KINDS) expect(desc).toContain(kind)
  })

  it('decide_task_suggestion documents the hand-off contact gate', () => {
    const desc = description('decide_task_suggestion')
    expect(desc).toContain('hand_off_request')
    expect(desc).toContain('contact_required')
  })

  it('decide_task_suggestion documents the duplicate guard and the way past it', () => {
    const desc = description('decide_task_suggestion')
    expect(desc).toContain('possible_duplicate')
    expect(desc).toContain('attach')
    expect(desc).toContain('force')
  })

  it('rebuild_task_suggestions says a rebuild adds rather than replaces, and takes the three switches', () => {
    const desc = description('rebuild_task_suggestions')
    expect(desc).toContain('Nothing already filed is expired or changed')
    expect(desc).toContain('replace true')
    const properties = TOOLS.find(t => t.name === 'rebuild_task_suggestions')?.inputSchema.properties as Record<string, unknown> | undefined
    expect(properties).toHaveProperty('replace')
    expect(properties).toHaveProperty('second_pass')
    expect(properties).toHaveProperty('read_now')
  })

  it('cron_suggest_from_transcripts says each call is read twice and takes the two knobs', () => {
    expect(description('cron_suggest_from_transcripts')).toContain('read twice')
    const properties = TOOLS.find(t => t.name === 'cron_suggest_from_transcripts')?.inputSchema.properties as Record<string, unknown> | undefined
    expect(properties).toHaveProperty('limit')
    expect(properties).toHaveProperty('second_pass')
  })

  it('decide_task_suggestion takes the attach arguments', () => {
    const tool = TOOLS.find(t => t.name === 'decide_task_suggestion')
    const properties = tool?.inputSchema.properties as Record<string, unknown> | undefined
    expect(properties).toHaveProperty('target_kind')
    expect(properties).toHaveProperty('target_id')
    expect(properties).toHaveProperty('force')
  })
})
