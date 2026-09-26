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
 *   THE GATE, PER ROW (CN.3 section 6). A call's suggestion is the founders'
 *   to decide; a note is its sender's (and any founder's); a client's draft is
 *   that client's alone. Anyone else gets one sentence that says nothing
 *   about what exists, including whether the row exists.
 *
 *   A CLIENT NEVER SEES THE DUPLICATE ANSWER. Their approve carries force,
 *   and the two buttons that only exist on that answer are refused.
 *
 *   THE DASHBOARD'S SCOPING. A studio press passes the same access rule the
 *   decide route runs through guardSuggestion. A member scoped away from a
 *   client cannot approve their own note about that client here either.
 *
 *   THE SECOND CLICK. Two founders hold the same message. The second press
 *   must be a no-op that tidies the message, not a second task.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Param, is } from 'drizzle-orm'
import { schema } from '@/db/d1'

const decideCalls: Array<{ id: string; decision: unknown; ctx: unknown }> = []
const mirrored: Array<{ id: string; status: string }> = []
const rewritten: Array<{ id: string; duplicate: boolean }> = []
const recorded: Array<{ suggestionId: string; channelId: string; ts: string }> = []

let decideResult: Record<string, unknown> | null = null
let decoratedRow: Record<string, unknown> | null = null
let loadedRow: Record<string, unknown> | null = null
let mirrorThrows = false

/** Team member id to Clerk user id, which is what scoping keys on. */
const clerkIds = new Map<string, string | null>()
/** Clerk user id to the clients that person can reach; null is everything.
 *  Anybody missing reaches nothing, as the real resolver answers them. */
const scopes = new Map<string | null, string[] | null>()
const scopeLookups: Array<string | null> = []
let scopeThrows = false

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async (_database: unknown, clerkUserId: string | null) => {
    scopeLookups.push(clerkUserId)
    if (scopeThrows) throw new Error('D1_ERROR: scoping lookup failed')
    return scopes.has(clerkUserId) ? scopes.get(clerkUserId) ?? null : []
  },
}))

vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  return {
    ...actual,
    decideSuggestion: async (_drizzle: unknown, id: string, decision: unknown, ctx: unknown) => {
      decideCalls.push({ id, decision, ctx })
      return decideResult
    },
    loadDecoratedSuggestion: async () => decoratedRow,
    loadSuggestion: async () => loadedRow,
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

const {
  DISPATCH_LINES,
  canDecideSuggestion,
  handleDigestAction,
  handleSuggestionAction,
  registerSuggestionActions,
} = await import('../slack/dispatch-actions')
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

const MEMBER = {
  ...FOUNDER,
  id: 'si2',
  slackUserId: 'U_NATHAN',
  email: 'nathan@tahi.studio',
  level: 'member' as const,
  teamMemberId: 'tm_nathan',
  dmChannelId: 'D_NATHAN',
}

const CLIENT = {
  ...FOUNDER,
  id: 'si3',
  slackUserId: 'U_TIM',
  email: 'tim@verandela.co.nz',
  level: 'client' as const,
  teamMemberId: null,
  contactId: 'c_tim',
  orgId: 'o_ver',
  dmChannelId: 'D_TIM',
}

/** The stored row the gate reads before anything is decided. */
function stored(overrides: Record<string, unknown> = {}) {
  return { id: 's1', status: 'pending', approverType: 'founders', approverId: null, orgId: 'o_ver', ...overrides }
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

/** The value bound into a drizzle `eq(column, value)`. */
function boundValue(condition: unknown): unknown {
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? []
  const param = chunks.find(chunk => is(chunk, Param))
  return param ? (param as Param).value : undefined
}

/** The one read the handler makes itself: a team member's Clerk user id. */
function scopingDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          limit: async () => {
            if (table !== schema.teamMembers) return []
            const id = boundValue(condition)
            return typeof id === 'string' && clerkIds.has(id) ? [{ clerkUserId: clerkIds.get(id) ?? null }] : []
          },
        }),
      }),
    }),
  }
}

function click(action: string, overrides: Record<string, unknown> = {}) {
  return {
    drizzle: scopingDb() as never,
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
  loadedRow = stored()
  mirrorThrows = false
  // Liam holds super_admin, which the resolver answers as everything. Nathan
  // is scoped to Verandela alone.
  clerkIds.clear()
  clerkIds.set('tm_liam', 'clerk_liam')
  clerkIds.set('tm_nathan', 'clerk_nathan')
  scopes.clear()
  scopes.set('clerk_liam', null)
  scopes.set('clerk_nathan', ['o_ver'])
  scopeLookups.length = 0
  scopeThrows = false
})

describe('canDecideSuggestion', () => {
  const founders = { approverType: 'founders', approverId: null, orgId: 'o_ver' }
  const nathansNote = { approverType: 'member', approverId: 'tm_nathan', orgId: 'o_ver' }
  const staciNote = { approverType: 'member', approverId: 'tm_staci', orgId: null }
  const timsDraft = { approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' }

  it('lets a founder decide a call suggestion', () => {
    expect(canDecideSuggestion(FOUNDER, founders)).toBe(true)
  })

  it('lets a member decide their own note, and nothing else', () => {
    expect(canDecideSuggestion(MEMBER, nathansNote)).toBe(true)
    expect(canDecideSuggestion(MEMBER, staciNote)).toBe(false)
    expect(canDecideSuggestion(MEMBER, founders)).toBe(false)
    expect(canDecideSuggestion({ ...MEMBER, teamMemberId: null }, { ...nathansNote, approverId: null })).toBe(false)
  })

  it('lets a founder decide any member note, their own included', () => {
    expect(canDecideSuggestion(FOUNDER, nathansNote)).toBe(true)
    expect(canDecideSuggestion(FOUNDER, { approverType: 'member', approverId: 'tm_liam', orgId: null })).toBe(true)
  })

  it('lets a client confirm their own draft, at their own client, and nothing else', () => {
    expect(canDecideSuggestion(CLIENT, timsDraft)).toBe(true)
    expect(canDecideSuggestion(CLIENT, { ...timsDraft, approverId: 'c_someone_else' })).toBe(false)
    expect(canDecideSuggestion(CLIENT, { ...timsDraft, orgId: 'o_other' })).toBe(false)
    expect(canDecideSuggestion(CLIENT, founders)).toBe(false)
    expect(canDecideSuggestion(CLIENT, nathansNote)).toBe(false)
  })

  it('keeps a client draft away from the studio in Slack, where it is the client who confirms', () => {
    expect(canDecideSuggestion(FOUNDER, timsDraft)).toBe(false)
    expect(canDecideSuggestion(MEMBER, timsDraft)).toBe(false)
  })

  it('refuses a stranger, a person the app has never seen, and an approver type nobody knows', () => {
    expect(canDecideSuggestion({ ...CLIENT, level: 'unknown' }, timsDraft)).toBe(false)
    expect(canDecideSuggestion({ ...FOUNDER, level: 'unknown' }, founders)).toBe(false)
    expect(canDecideSuggestion(null, founders)).toBe(false)
    expect(canDecideSuggestion(FOUNDER, { approverType: 'robots', approverId: null, orgId: null })).toBe(false)
  })
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
  it('refuses a member on a call suggestion with one sentence and decides nothing', async () => {
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
    expect(result.reply).toBe(DISPATCH_LINES.unknownActor)
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses a stranger before the row is even read', async () => {
    loadedRow = null
    const result = await handleSuggestionAction({ ...click('approve'), identity: { ...FOUNDER, level: 'unknown' } as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('tells a founder a missing row is gone', async () => {
    loadedRow = null
    const result = await handleSuggestionAction(click('approve'))
    expect(result).toEqual({ handled: true, reply: DISPATCH_LINES.gone })
    expect(decideCalls).toHaveLength(0)
  })

  it('tells a client nothing about a missing row, only the refusal', async () => {
    loadedRow = null
    const result = await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(result).toEqual({ handled: true, reply: SLACK_DENIED_LINE })
    expect(decideCalls).toHaveLength(0)
  })
})

describe('the sender approves their own note (CN.3 section 6)', () => {
  it('lets a member approve their own note, recorded as that member', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(decideCalls).toEqual([{ id: 's1', decision: { action: 'approve' }, ctx: { actorId: 'tm_nathan', via: 'slack' } }])
    expect(result.handled).toBe(true)
    expect(mirrored).toEqual([{ id: 's1', status: 'applied' }])
  })

  it('refuses a member on another member note', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_staci' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('lets a founder decide a member note too, as the founder', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan' })
    await handleSuggestionAction(click('reject'))
    expect(decideCalls).toEqual([{ id: 's1', decision: { action: 'reject' }, ctx: { actorId: 'tm_liam', via: 'slack' } }])
  })
})

describe('the dashboard scoping, in Slack (guardSuggestion)', () => {
  it('refuses a member their own note at a client outside their scope, and records and decides nothing', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: 'o_ele' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result).toEqual({ handled: true, reply: SLACK_DENIED_LINE })
    expect(scopeLookups).toEqual(['clerk_nathan'])
    expect(decideCalls).toHaveLength(0)
    expect(recorded).toHaveLength(0)
    expect(rewritten).toHaveLength(0)
    expect(mirrored).toHaveLength(0)
  })

  it('still lets a member approve their own note at a client in their scope', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: 'o_ver' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result).toEqual({ handled: true, reply: null })
    expect(decideCalls).toEqual([{ id: 's1', decision: { action: 'approve' }, ctx: { actorId: 'tm_nathan', via: 'slack' } }])
    expect(recorded).toHaveLength(1)
  })

  it('leaves a founder unaffected, at any client', async () => {
    loadedRow = stored({ orgId: 'o_ele' })
    await handleSuggestionAction(click('approve'))
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: 'o_somewhere_else' })
    await handleSuggestionAction(click('reject'))
    expect(scopeLookups).toEqual(['clerk_liam', 'clerk_liam'])
    expect(decideCalls.map(call => (call.ctx as { actorId: string }).actorId)).toEqual(['tm_liam', 'tm_liam'])
  })

  it('holds a cached founder whose super_admin has ended to their scope, as the dashboard does', async () => {
    scopes.set('clerk_liam', ['o_ver'])
    loadedRow = stored({ orgId: 'o_ele' })
    const result = await handleSuggestionAction(click('approve'))
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('reads a note with no client as studio housekeeping, open without a lookup', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: null })
    await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(scopeLookups).toHaveLength(0)
    expect(decideCalls).toHaveLength(1)
  })

  it('refuses when the scoping lookup throws', async () => {
    scopeThrows = true
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: 'o_ver' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a member with no Clerk login, whom the dashboard would refuse too', async () => {
    clerkIds.delete('tm_nathan')
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: 'o_ver' })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(scopeLookups).toEqual([null])
    expect(decideCalls).toHaveLength(0)
  })

  it('does not look a client up in the studio scoping at all', async () => {
    loadedRow = stored({ approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
    await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(scopeLookups).toHaveLength(0)
    expect(decideCalls).toHaveLength(1)
  })
})

describe('a client confirms their own request', () => {
  beforeEach(() => {
    loadedRow = stored({ approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
  })

  it('sends their approve with force, recorded against their contact id', async () => {
    const result = await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(decideCalls).toEqual([{
      id: 's1',
      decision: { action: 'approve', force: true },
      ctx: { actorId: 'c_tim', via: 'slack' },
    }])
    expect(result).toEqual({ handled: true, reply: null })
    expect(mirrored).toEqual([{ id: 's1', status: 'applied' }])
  })

  it('refuses a client attach and approve anyway, which only the duplicate answer offers', async () => {
    const attach = await handleSuggestionAction({
      ...click('attach', { value: JSON.stringify({ kind: 'request', id: 'r1' }) }),
      identity: CLIENT as Identity,
    })
    const anyway = await handleSuggestionAction({ ...click('approve_anyway'), identity: CLIENT as Identity })
    expect(attach.reply).toBe(SLACK_DENIED_LINE)
    expect(anyway.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
    expect(recorded).toHaveLength(0)
  })

  it('lets a client reject or snooze their own draft', async () => {
    decideResult = { suggestion: row({ status: 'rejected' }), changed: true }
    await handleSuggestionAction({ ...click('reject'), identity: CLIENT as Identity })
    await handleSuggestionAction({ ...click('snooze_week'), identity: CLIENT as Identity })
    expect(decideCalls.map(call => (call.decision as { action: string }).action)).toEqual(['reject', 'snooze'])
    expect(decideCalls.every(call => (call.ctx as { actorId: string }).actorId === 'c_tim')).toBe(true)
  })

  it('refuses another contact at the same client', async () => {
    const result = await handleSuggestionAction({
      ...click('approve'),
      identity: { ...CLIENT, contactId: 'c_ngaire' } as Identity,
    })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses the same contact id at another client', async () => {
    const result = await handleSuggestionAction({
      ...click('approve'),
      identity: { ...CLIENT, orgId: 'o_other' } as Identity,
    })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('refuses a client on a call suggestion or a member note', async () => {
    loadedRow = stored()
    const onCall = await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan' })
    const onNote = await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(onCall.reply).toBe(SLACK_DENIED_LINE)
    expect(onNote.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
  })

  it('answers the refusal, not "gone", when the row vanished between the read and the decision', async () => {
    decideResult = null
    const result = await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
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

  it('claims the Monday digest button and answers it with nothing, to anybody', async () => {
    clearBlockActionHandlers()
    registerSuggestionActions()
    expect(resolveBlockActionHandler('digest:open_inbox')).toBe(handleDigestAction)
    const result = await handleDigestAction({ ...click('approve', { actionId: 'digest:open_inbox' }), identity: MEMBER as Identity })
    expect(result).toEqual({ handled: true, reply: null })
    expect(decideCalls).toHaveLength(0)
  })

  it('does not claim an action id from another prefix through the digest handler', async () => {
    const result = await handleDigestAction(click('approve'))
    expect(result.handled).toBe(false)
  })
})
