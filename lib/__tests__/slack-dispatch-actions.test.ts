/**
 * lib/slack/dispatch-actions.ts, the half second between a founder pressing
 * Approve in a DM and a task existing.
 *
 * What is pinned here:
 *
 *   THE ACTOR. A decision made in Slack has to land on the row as the founder
 *   who pressed it, with via 'slack'. An anonymous decision is worse than no
 *   decision: the audit trail is the reason a bot is allowed to write at all.
 *
 *   THE GATE. Only a founder decides a call's suggestions (CN.2 section 1).
 *   Anyone else gets one sentence that says nothing about what exists.
 *
 *   THE SECOND CLICK. Two founders hold the same message. The second press
 *   must be a no-op that tidies the message, not a second task.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const decideCalls: Array<{ id: string; decision: unknown; ctx: unknown }> = []
const mirrored: Array<{ id: string; status: string }> = []
const rewritten: Array<{ id: string; duplicate: boolean }> = []
const recorded: Array<{ suggestionId: string; channelId: string; ts: string }> = []

let decideResult: Record<string, unknown> | null = null
let decoratedRow: Record<string, unknown> | null = null
let mirrorThrows = false

vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  return {
    ...actual,
    decideSuggestion: async (_drizzle: unknown, id: string, decision: unknown, ctx: unknown) => {
      decideCalls.push({ id, decision, ctx })
      return decideResult
    },
    loadDecoratedSuggestion: async () => decoratedRow,
  }
})

vi.mock('@/lib/slack/mirror', () => ({
  mirrorSuggestionDecision: async (_drizzle: unknown, row: { id: string; status: string }) => {
    if (mirrorThrows) throw new Error('slack down')
    mirrored.push({ id: row.id, status: row.status })
    return 1
  },
  rewriteSuggestionMessage: async (_drizzle: unknown, row: { id: string }, options?: { duplicate?: boolean }) => {
    rewritten.push({ id: row.id, duplicate: options?.duplicate === true })
    return 1
  },
  recordSuggestionMessage: async (_drizzle: unknown, copy: { suggestionId: string; channelId: string; ts: string }) => {
    recorded.push(copy)
    return true
  },
}))

const { handleSuggestionAction, registerSuggestionActions } = await import('../slack/dispatch-actions')
const { SLACK_DENIED_LINE } = await import('../slack/identity')
const { clearBlockActionHandlers, resolveBlockActionHandler } = await import('../slack/action-registry')
const { suggestionActionId } = await import('../slack/blocks')
const { POSSIBLE_DUPLICATE, CONTACT_REQUIRED } = await import('../task-suggestions')

type Identity = Parameters<typeof handleSuggestionAction>[0]['identity']

const FOUNDER = {
  id: 'si1',
  slackTeamId: 'T1',
  slackUserId: 'U_LIAM',
  email: 'liam@tahi.studio',
  level: 'founder' as const,
  teamMemberId: 'tm_liam',
  contactId: null,
  orgId: null,
  dmChannelId: 'D_LIAM',
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    status: 'applied',
    snoozeUntil: null,
    decidedById: 'tm_liam',
    decidedAt: '2026-09-22T21:41:00Z',
    updatedAt: '2026-09-22T21:41:00Z',
    applyError: null,
    ...overrides,
  }
}

function click(action: string, overrides: Record<string, unknown> = {}) {
  return {
    drizzle: {} as never,
    identity: FOUNDER as Identity,
    payload: {
      actionId: suggestionActionId(action as never, 's1'),
      value: null,
      slackUserId: 'U_LIAM',
      slackTeamId: 'T1',
      channelId: 'D_LIAM',
      messageTs: '1758500000.0001',
      ...overrides,
    },
  }
}

beforeEach(() => {
  decideCalls.length = 0
  mirrored.length = 0
  rewritten.length = 0
  recorded.length = 0
  decideResult = { suggestion: row(), changed: true, appliedTaskId: 'task_new', appliedRequestId: null }
  decoratedRow = { id: 's1', kind: 'create_task', proposal: { title: 'Cut the hero video' }, quote: 'Cut it to thirty seconds.', similar: [] }
  mirrorThrows = false
})

describe('action ids this handler does not own', () => {
  it('passes on an action id from another feature', async () => {
    const result = await handleSuggestionAction(click('approve', { actionId: 'nudge:send:n1' }))
    expect(result.handled).toBe(false)
    expect(decideCalls).toHaveLength(0)
  })

  it('passes on a malformed sugg id rather than guessing the suggestion', async () => {
    const result = await handleSuggestionAction(click('approve', { actionId: 'sugg:approve' }))
    expect(result.handled).toBe(false)
    expect(decideCalls).toHaveLength(0)
  })
})

describe('the gate', () => {
  it('refuses a member with one sentence and decides nothing', async () => {
    const result = await handleSuggestionAction({
      ...click('approve'),
      identity: { ...FOUNDER, level: 'member', teamMemberId: 'tm_other' } as Identity,
    })
    expect(result).toEqual({ handled: true, reply: SLACK_DENIED_LINE })
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses a client the same way', async () => {
    const result = await handleSuggestionAction({
      ...click('approve'),
      identity: { ...FOUNDER, level: 'client', teamMemberId: null, contactId: 'c1', orgId: 'o1' } as Identity,
    })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses a Slack user the app has never seen', async () => {
    const result = await handleSuggestionAction({ ...click('approve'), identity: null })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses a founder with no team member row rather than deciding anonymously', async () => {
    const result = await handleSuggestionAction({
      ...click('approve'),
      identity: { ...FOUNDER, teamMemberId: null } as Identity,
    })
    expect(result.handled).toBe(true)
    expect(result.reply).toBeTruthy()
    expect(decideCalls).toHaveLength(0)
  })
})

describe('mapping a click to a decision', () => {
  it('approves as the founder who pressed it, via slack', async () => {
    const result = await handleSuggestionAction(click('approve'))
    expect(decideCalls).toEqual([{ id: 's1', decision: { action: 'approve' }, ctx: { actorId: 'tm_liam', via: 'slack' } }])
    expect(result.handled).toBe(true)
  })

  it('approves anyway with force, which is the duplicate answer being overridden', async () => {
    await handleSuggestionAction(click('approve_anyway'))
    expect(decideCalls[0].decision).toEqual({ action: 'approve', force: true })
  })

  it('rejects', async () => {
    await handleSuggestionAction(click('reject'))
    expect(decideCalls[0].decision).toEqual({ action: 'reject' })
  })

  it('snoozes to tonight with the studio preset', async () => {
    decideResult = { suggestion: row({ status: 'snoozed', snoozeUntil: '2026-09-22T07:00:00Z' }), changed: true }
    await handleSuggestionAction(click('snooze_tonight'))
    const decision = decideCalls[0].decision as { action: string; until: string }
    expect(decision.action).toBe('snooze')
    expect(decision.until).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('snoozes to this week with a later time than tonight', async () => {
    decideResult = { suggestion: row({ status: 'snoozed' }), changed: true }
    await handleSuggestionAction(click('snooze_tonight'))
    await handleSuggestionAction(click('snooze_week'))
    const tonight = (decideCalls[0].decision as { until: string }).until
    const week = (decideCalls[1].decision as { until: string }).until
    expect(week >= tonight).toBe(true)
  })

  it('attaches to the target the button carried', async () => {
    decideResult = { suggestion: row({ status: 'pending' }), changed: true }
    await handleSuggestionAction(click('attach', { value: JSON.stringify({ kind: 'request', id: 'r1' }) }))
    expect(decideCalls[0].decision).toEqual({ action: 'attach', target: { kind: 'request', id: 'r1' } })
  })

  it('says so rather than guessing when the attach value is unreadable', async () => {
    const result = await handleSuggestionAction(click('attach', { value: 'not json' }))
    expect(result.handled).toBe(true)
    expect(result.reply).toBeTruthy()
    expect(decideCalls).toHaveLength(0)
  })

  it('treats Tweak as nothing to decide, because it is a link', async () => {
    const result = await handleSuggestionAction(click('tweak'))
    expect(result).toEqual({ handled: true, reply: null })
    expect(decideCalls).toHaveLength(0)
  })
})

describe('the message after the click', () => {
  it('remembers the clicked message as a copy so the rewrite reaches it', async () => {
    await handleSuggestionAction(click('approve'))
    expect(recorded).toEqual([{ suggestionId: 's1', channelId: 'D_LIAM', ts: '1758500000.0001' }])
  })

  it('rewrites every copy to the decided line and says nothing extra', async () => {
    const result = await handleSuggestionAction(click('approve'))
    expect(mirrored).toEqual([{ id: 's1', status: 'applied' }])
    expect(result.reply).toBeNull()
  })

  it('rewrites the copies when the apply failed, so the line says what happened', async () => {
    decideResult = { suggestion: row({ status: 'failed', applyError: 'Task not found' }), changed: true }
    await handleSuggestionAction(click('approve'))
    expect(mirrored).toEqual([{ id: 's1', status: 'failed' }])
  })

  it('answers a second click by tidying the message, not by deciding again', async () => {
    decideResult = { suggestion: row({ status: 'applied' }), changed: false, appliedTaskId: 'task_new' }
    const result = await handleSuggestionAction(click('approve'))
    expect(decideCalls).toHaveLength(1)
    expect(mirrored).toEqual([{ id: 's1', status: 'applied' }])
    expect(result.reply).toBeTruthy()
  })

  it('re-renders the row with the duplicate answer when the gate refused a create', async () => {
    decideResult = {
      suggestion: row({ status: 'pending' }),
      changed: false,
      error: POSSIBLE_DUPLICATE,
      similar: [{ kind: 'request', id: 'r1', number: 226, title: 'Design directions', status: 'open', score: 0.91 }],
    }
    const result = await handleSuggestionAction(click('approve'))
    expect(rewritten).toEqual([{ id: 's1', duplicate: true }])
    expect(mirrored).toHaveLength(0)
    expect(result.handled).toBe(true)
  })

  it('re-renders with the buttons after an attach, because the row is still waiting', async () => {
    decideResult = { suggestion: row({ status: 'pending' }), changed: true }
    await handleSuggestionAction(click('attach', { value: JSON.stringify({ kind: 'task', id: 't1' }) }))
    expect(rewritten).toEqual([{ id: 's1', duplicate: false }])
    expect(mirrored).toHaveLength(0)
  })

  it('asks for the contact rather than failing when a hand-off names nobody', async () => {
    decideResult = { suggestion: row({ status: 'pending' }), changed: false, error: CONTACT_REQUIRED }
    const result = await handleSuggestionAction(click('approve'))
    expect(result.reply).toBeTruthy()
    expect(mirrored).toHaveLength(0)
  })

  it('says the row is gone when the id names nothing', async () => {
    decideResult = null
    const result = await handleSuggestionAction(click('approve'))
    expect(result.handled).toBe(true)
    expect(result.reply).toBeTruthy()
    expect(mirrored).toHaveLength(0)
  })

  it('still reports the decision when Slack cannot be rewritten', async () => {
    mirrorThrows = true
    const result = await handleSuggestionAction(click('approve'))
    expect(decideCalls).toHaveLength(1)
    expect(result.handled).toBe(true)
  })
})

describe('registration through the interactive route hook', () => {
  it('claims every sugg: action id', () => {
    clearBlockActionHandlers()
    registerSuggestionActions()
    expect(resolveBlockActionHandler('sugg:approve:s1')).toBe(handleSuggestionAction)
    expect(resolveBlockActionHandler('nudge:send:n1')).toBeNull()
  })
})
