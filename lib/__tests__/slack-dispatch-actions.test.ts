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
 *   A CLIENT'S PRESS STAYS IN THEIR OWN CARD (the client copy policy, CN.3
 *   section 2). Approve and Reject only; nothing recorded as a copy; no
 *   studio re-render and no studio decided line; the one write is the card
 *   they pressed, through rewriteClientCard.
 *
 *   THE DASHBOARD'S SCOPING. A studio press passes the same access rule the
 *   decide route runs through guardSuggestion. A member scoped away from a
 *   client cannot approve their own note about that client here either.
 *
 *   THE SECOND CLICK. Two founders hold the same message. The second press
 *   must be a no-op that tidies the message, not a second task.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Param, is } from 'drizzle-orm'
import { schema } from '@/db/d1'

const decideCalls: Array<{ id: string; decision: unknown; ctx: unknown }> = []
const mirrored: Array<{ id: string; status: string }> = []
const rewritten: Array<{ id: string; duplicate: boolean }> = []
const recorded: Array<{ suggestionId: string; channelId: string; ts: string }> = []
const clientCards: Array<{ channelId: string | null; ts: string | null; id: string; status: string }> = []

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
const activeRoles = new Map<string, string[]>()
const deniedFeatures = new Set<string>()
let permissionThrows = false
let roleThrows = false

vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions')
  return {
    ...actual,
    resolvePermissions: async (_database: unknown, auth: { userId: string; orgId: string }) => {
      if (permissionThrows) throw new Error('permissions unavailable')
      const founder = auth.userId === 'clerk_liam'
      return { ...auth, level: founder ? 'super_admin' : 'team_member', audience: 'team',
        isSuperAdmin: founder, isAdmin: founder, canManagePermissions: founder,
        viewableResources: founder ? null : new Set(['tasks', 'requests']),
        overrides: new Map([...deniedFeatures].map(feature => [feature, 'deny'])) }
    },
  }
})

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
  rewriteClientCard: async (
    _drizzle: unknown,
    card: { channelId: string | null; ts: string | null },
    row: { id: string; status: string },
  ) => {
    clientCards.push({ channelId: card.channelId, ts: card.ts, id: row.id, status: row.status })
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
  return { id: 's1', kind: 'create_task', status: 'pending', approverType: 'founders', approverId: null, orgId: 'o_ver', ...overrides }
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

/** Every value bound anywhere in a drizzle condition, in order: for
 *  `and(eq(a, x), eq(b, y))` that is [x, y]. */
function boundValues(condition: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (node: unknown): void => {
    if (is(node, Param)) {
      out.push((node as Param).value)
      return
    }
    const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks
    if (Array.isArray(chunks)) chunks.forEach(walk)
  }
  walk(condition)
  return out
}

/** The contacts rows the portal gate may find (by id, at their own client). */
const contactRows = new Map<string, { id: string; orgId: string; portalRole: string; isPrimary: boolean }>()
/** feature_visibility, as the permissions builder writes it. */
let featureRows: Array<{ subjectType: string; subjectId: string; featureKey: string; effect: string }> = []
let featureThrows = false

/**
 * The reads the handler makes itself: a team member's Clerk user id (the
 * studio scoping), and for a client's Approve their contacts row and the
 * feature_visibility rows (the portal's Requests gate).
 */
function scopingDb() {
  const rowsFor = (table: unknown, condition: unknown): Array<Record<string, unknown>> => {
    if (table === schema.teamMembers) {
      const id = boundValue(condition)
      return typeof id === 'string' && clerkIds.has(id) ? [{ clerkUserId: clerkIds.get(id) ?? null }] : []
    }
    if (table === schema.teamMemberRoles) {
      if (roleThrows) throw new Error('active role read failed')
      const [memberId] = boundValues(condition)
      return (activeRoles.get(String(memberId)) ?? []).map(name => ({ name }))
    }
    if (table === schema.contacts) {
      const [id, orgId] = boundValues(condition)
      const contact = typeof id === 'string' ? contactRows.get(id) : undefined
      return contact && contact.orgId === orgId ? [contact] : []
    }
    if (table === schema.featureVisibility) {
      if (featureThrows) throw new Error('D1_ERROR: feature_visibility read failed')
      const [subjectType, subjectId] = boundValues(condition)
      return featureRows
        .filter(rule => rule.subjectType === subjectType && rule.subjectId === subjectId)
        .map(rule => ({ featureKey: rule.featureKey, effect: rule.effect }))
    }
    return []
  }
  return {
    select: () => ({
      from: (table: unknown) => ({
        innerJoin: () => ({ where: async (condition: unknown) => rowsFor(table, condition) }),
        where: (condition: unknown) => {
          const read = async () => rowsFor(table, condition)
          return {
            limit: read,
            then: <T>(resolve: (rows: Array<Record<string, unknown>>) => T, reject?: (error: unknown) => T) =>
              read().then(resolve, reject),
          }
        },
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
  clientCards.length = 0
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
  activeRoles.clear()
  activeRoles.set('tm_liam', ['super_admin'])
  activeRoles.set('tm_nathan', ['task_handler'])
  deniedFeatures.clear()
  permissionThrows = false
  roleThrows = false
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  // Tim is a contact at Verandela with the Requests feature on (the client
  // default: no feature_visibility row at all).
  contactRows.clear()
  contactRows.set('c_tim', { id: 'c_tim', orgId: 'o_ver', portalRole: 'member', isPrimary: false })
  featureRows = []
  featureThrows = false
})

afterEach(() => vi.unstubAllEnvs())

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

  it('checks grants and organisation access for studio housekeeping too', async () => {
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: null })
    await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(scopeLookups).toEqual(['clerk_nathan'])
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
    expect(scopeLookups).toEqual([])
    expect(decideCalls).toHaveLength(0)
  })

  it('does not look a client up in the studio scoping at all', async () => {
    loadedRow = stored({ kind: 'create_request', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
    await handleSuggestionAction({ ...click('approve'), identity: CLIENT as Identity })
    expect(scopeLookups).toHaveLength(0)
    expect(decideCalls).toHaveLength(1)
  })
})

describe('studio feature and active-role denials before recording or deciding', () => {
  it.each([
    ['create_task', 'tasks'], ['update_task', 'tasks'], ['complete_task', 'tasks'], ['add_subtasks', 'tasks'], ['note', 'tasks'],
    ['create_request', 'requests'], ['update_request', 'requests'], ['request_note', 'requests'], ['hand_off_request', 'requests'],
  ])('refuses %s when %s is denied, including null-org suggestions', async (kind, feature) => {
    deniedFeatures.add(feature)
    for (const orgId of ['o_ver', null]) {
      loadedRow = stored({ kind, approverType: 'member', approverId: 'tm_nathan', orgId })
      const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
      expect(result.reply).toBe(SLACK_DENIED_LINE)
    }
    expect(recorded).toEqual([])
    expect(decideCalls).toEqual([])
    expect(rewritten).toEqual([])
    expect(mirrored).toEqual([])
  })

  it('checks the target feature before an attach can change the suggestion family', async () => {
    deniedFeatures.add('requests')
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan' })
    const result = await handleSuggestionAction({ ...click('attach', { value: JSON.stringify({ kind: 'request', id: 'r1' }) }), identity: MEMBER as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(recorded).toEqual([])
    expect(decideCalls).toEqual([])
  })

  it.each(['roleless', 'role lookup failed', 'permission lookup failed', 'no organisation access'])('refuses a null-org note for %s', async failure => {
    if (failure === 'roleless') activeRoles.set('tm_nathan', [])
    if (failure === 'role lookup failed') roleThrows = true
    if (failure === 'permission lookup failed') permissionThrows = true
    if (failure === 'no organisation access') scopes.set('clerk_nathan', [])
    loadedRow = stored({ approverType: 'member', approverId: 'tm_nathan', orgId: null })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(recorded).toEqual([])
    expect(decideCalls).toEqual([])
  })

  it('refuses a cached founder downgraded to a feature-granted member', async () => {
    activeRoles.set('tm_liam', ['task_handler'])
    const result = await handleSuggestionAction(click('approve'))
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(recorded).toEqual([])
    expect(decideCalls).toEqual([])
  })

  it('allows a member with only the request feature to approve their own null-org request', async () => {
    deniedFeatures.add('tasks')
    loadedRow = stored({ kind: 'create_request', approverType: 'member', approverId: 'tm_nathan', orgId: null })
    const result = await handleSuggestionAction({ ...click('approve'), identity: MEMBER as Identity })
    expect(result.reply).toBeNull()
    expect(decideCalls).toHaveLength(1)
    expect(recorded).toHaveLength(1)
  })
})

describe('a client confirms their own request', () => {
  /** A press on Tim's own card, in Tim's own DM. */
  function timClick(action: string, overrides: Record<string, unknown> = {}) {
    const base = click(action, { slackUserId: 'U_TIM', channelId: 'D_TIM', messageTs: '1758500000.0042', ...overrides })
    return { ...base, identity: CLIENT as Identity }
  }

  beforeEach(() => {
    loadedRow = stored({ kind: 'create_request', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
    decideResult = {
      suggestion: row({ decidedById: 'c_tim', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' }),
      changed: true,
      appliedTaskId: null,
      appliedRequestId: 'r_new',
    }
  })

  it('sends their approve with force, recorded against their contact id', async () => {
    const result = await handleSuggestionAction(timClick('approve'))
    expect(decideCalls).toEqual([{
      id: 's1',
      decision: { action: 'approve', force: true },
      ctx: { actorId: 'c_tim', via: 'slack' },
    }])
    expect(result).toEqual({ handled: true, reply: null })
  })

  it('rewrites only the card they pressed, through the client renderer, and files no copy of it', async () => {
    await handleSuggestionAction(timClick('approve'))
    expect(clientCards).toEqual([{ channelId: 'D_TIM', ts: '1758500000.0042', id: 's1', status: 'applied' }])
    expect(recorded).toHaveLength(0)
    expect(mirrored).toHaveLength(0)
    expect(rewritten).toHaveLength(0)
  })

  it('lets a client reject their own draft, through the same client path', async () => {
    decideResult = { suggestion: row({ status: 'rejected', decidedById: 'c_tim', approverType: 'contact' }), changed: true }
    const result = await handleSuggestionAction(timClick('reject'))
    expect(decideCalls.map(call => call.decision)).toEqual([{ action: 'reject' }])
    expect(result.reply).toBeNull()
    expect(clientCards.map(card => card.status)).toEqual(['rejected'])
    expect(recorded).toHaveLength(0)
    expect(mirrored).toHaveLength(0)
  })

  it('refuses Tonight and This week, which a client card never offers, and decides nothing', async () => {
    const tonight = await handleSuggestionAction(timClick('snooze_tonight'))
    const week = await handleSuggestionAction(timClick('snooze_week'))
    expect(tonight.reply).toBe(SLACK_DENIED_LINE)
    expect(week.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
    expect(recorded).toHaveLength(0)
    expect(clientCards).toHaveLength(0)
  })

  it('refuses their approve once the studio has re-pointed the draft, but still takes a reject', async () => {
    loadedRow = stored({ kind: 'request_note', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
    const approve = await handleSuggestionAction(timClick('approve'))
    expect(approve.reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
    decideResult = { suggestion: row({ status: 'rejected', decidedById: 'c_tim', approverType: 'contact' }), changed: true }
    await handleSuggestionAction(timClick('reject'))
    expect(decideCalls.map(call => (call.decision as { action: string }).action)).toEqual(['reject'])
  })

  it('answers a second press with the plain line and tidies only their own card', async () => {
    decideResult = { suggestion: row({ status: 'rejected', decidedById: 'tm_liam', approverType: 'contact' }), changed: false }
    const result = await handleSuggestionAction(timClick('approve'))
    expect(result.reply).toBe(DISPATCH_LINES.alreadyDecided)
    expect(clientCards).toEqual([{ channelId: 'D_TIM', ts: '1758500000.0042', id: 's1', status: 'rejected' }])
    expect(mirrored).toHaveLength(0)
  })

  it('reads any refusal from the gate as the plain refusal, and re-renders nothing', async () => {
    decideResult = {
      suggestion: row({ status: 'pending', approverType: 'contact' }),
      changed: false,
      error: POSSIBLE_DUPLICATE,
      similar: [{ kind: 'task', id: 't_int', number: null, title: 'Brand refresh internal', status: 'todo', score: 0.95 }],
    }
    const result = await handleSuggestionAction(timClick('approve'))
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(rewritten).toHaveLength(0)
    expect(clientCards).toHaveLength(0)
    expect(mirrored).toHaveLength(0)
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

describe("a client's Approve passes the portal's Requests gate (requirePortalFeature's rule)", () => {
  function timClick(action: string) {
    const base = click(action, { slackUserId: 'U_TIM', channelId: 'D_TIM', messageTs: '1758500000.0042' })
    return { ...base, identity: CLIENT as Identity }
  }

  function expectNothingFiled(reply: string | null): void {
    expect(reply).toBe(SLACK_DENIED_LINE)
    expect(decideCalls).toHaveLength(0)
    expect(clientCards).toHaveLength(0)
    expect(recorded).toHaveLength(0)
  }

  beforeEach(() => {
    loadedRow = stored({ kind: 'create_request', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' })
    decideResult = {
      suggestion: row({ decidedById: 'c_tim', approverType: 'contact', approverId: 'c_tim', orgId: 'o_ver' }),
      changed: true,
      appliedTaskId: null,
      appliedRequestId: 'r_new',
    }
  })

  it('refuses when Requests is denied for their whole client, and decides nothing', async () => {
    featureRows = [{ subjectType: 'organisation', subjectId: 'o_ver', featureKey: 'requests', effect: 'deny' }]
    const result = await handleSuggestionAction(timClick('approve'))
    expectNothingFiled(result.reply)
  })

  it('refuses when Requests is denied for them alone', async () => {
    featureRows = [{ subjectType: 'contact', subjectId: 'c_tim', featureKey: 'requests', effect: 'deny' }]
    const result = await handleSuggestionAction(timClick('approve'))
    expectNothingFiled(result.reply)
  })

  it('lets their own allow beat a deny for their client, most specific first, as the portal does', async () => {
    featureRows = [
      { subjectType: 'organisation', subjectId: 'o_ver', featureKey: 'requests', effect: 'deny' },
      { subjectType: 'contact', subjectId: 'c_tim', featureKey: 'requests', effect: 'allow' },
    ]
    const result = await handleSuggestionAction(timClick('approve'))
    expect(result.reply).toBeNull()
    expect(decideCalls).toHaveLength(1)
  })

  it("is not fooled by another contact's deny or another client's", async () => {
    featureRows = [
      { subjectType: 'contact', subjectId: 'c_ngaire', featureKey: 'requests', effect: 'deny' },
      { subjectType: 'organisation', subjectId: 'o_other', featureKey: 'requests', effect: 'deny' },
    ]
    const result = await handleSuggestionAction(timClick('approve'))
    expect(result.reply).toBeNull()
    expect(decideCalls).toHaveLength(1)
  })

  it('refuses a contact who is no longer on that client', async () => {
    contactRows.clear()
    const result = await handleSuggestionAction(timClick('approve'))
    expectNothingFiled(result.reply)
  })

  it('refuses when the permissions read fails', async () => {
    featureThrows = true
    const result = await handleSuggestionAction(timClick('approve'))
    expectNothingFiled(result.reply)
  })

  it('still takes their Reject, which files nothing', async () => {
    featureRows = [{ subjectType: 'organisation', subjectId: 'o_ver', featureKey: 'requests', effect: 'deny' }]
    decideResult = { suggestion: row({ status: 'rejected', decidedById: 'c_tim', approverType: 'contact' }), changed: true }
    const result = await handleSuggestionAction(timClick('reject'))
    expect(result.reply).toBeNull()
    expect(decideCalls.map(call => call.decision)).toEqual([{ action: 'reject' }])
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
