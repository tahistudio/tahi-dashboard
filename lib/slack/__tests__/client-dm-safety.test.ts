/**
 * The client copy policy, end to end (CN.3 contract section 2).
 *
 * A client's Slack DM only ever shows text written for the client: their own
 * words, their own request's title and number, and fixed client wording. It
 * never shows a studio-internal title, who snoozed something, an apply error,
 * a Tweak link, a duplicate candidate, a suggested owner or a task.
 *
 * The other test files pin each piece with its neighbours mocked. This one
 * runs the REAL press handler, the REAL mirror and the REAL renderers
 * together, against a database that even has a copy of the client's card on
 * file (the worst case: an older code path recorded one), and reads every
 * Slack call that lands in the client's DM on every path that could reach
 * it:
 *
 *   the client's own press (approve, reject, a snooze they are refused)
 *   a studio decision on the client's draft (the decide hook)
 *   a snooze on the client's draft coming back (the repost)
 *   the undecided re-render (the duplicate answer)
 *
 * The thread lines and the digest have their own client tests in
 * work-sync.test.ts and digest.test.ts; neither can address a client's DM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Param, is } from 'drizzle-orm'
import { schema } from '@/db/d1'

interface SlackCall { method: 'post' | 'update'; channel: string; ts?: string; text: string; blocks: unknown[] }
const slackCalls: SlackCall[] = []

vi.mock('@/lib/slack/api', () => ({
  slackBotToken: () => process.env.SLACK_BOT_TOKEN || null,
  postMessage: async (input: { channel: string; text: string; blocks?: readonly unknown[] }) => {
    slackCalls.push({ method: 'post', channel: input.channel, text: input.text, blocks: [...(input.blocks ?? [])] })
    return { channel: input.channel, ts: `1758600000.00${slackCalls.length}` }
  },
  updateMessage: async (input: { channel: string; ts: string; text: string; blocks?: readonly unknown[] }) => {
    slackCalls.push({ method: 'update', channel: input.channel, ts: input.ts, text: input.text, blocks: [...(input.blocks ?? [])] })
  },
  openDm: async (userId: string) => `D_${userId}`,
}))

/** The stored row and what a decision turns it into, set per test. */
let storedRow: Record<string, unknown> = {}
let decidedRow: Record<string, unknown> = {}
let decideChanged = true
const decisions: unknown[] = []

vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  const mirror = await import('@/lib/slack/mirror')
  return {
    ...actual,
    loadSuggestion: async () => storedRow,
    loadDecoratedSuggestion: async () => ({ ...storedRow, proposal: JSON.parse(String(storedRow.proposal)), similar: SIMILAR }),
    // What the real decideSuggestion does after its write: the Slack hook.
    decideSuggestion: async (drizzle: Parameters<typeof mirror.mirrorSuggestionDecision>[0], _id: string, decision: unknown) => {
      decisions.push(decision)
      await mirror.mirrorSuggestionDecision(drizzle, decidedRow as unknown as Parameters<typeof mirror.mirrorSuggestionDecision>[1])
      return { suggestion: decidedRow, changed: decideChanged, appliedTaskId: null, appliedRequestId: decidedRow.appliedRequestId ?? null }
    },
  }
})

vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: async () => null }))

const { handleSuggestionAction } = await import('../dispatch-actions')
const { handleSlackDm } = await import('../dispatch-dm')
const { mirrorSuggestionDecision, repostSuggestion, rewriteSuggestionMessage } = await import('../mirror')
const { SLACK_DENIED_LINE } = await import('../identity')
const { NOTE_REPLY_CLIENT } = await import('../notes')

/** A studio-internal task the duplicate matcher would name. */
const SIMILAR = [{ kind: 'task', id: 't_int', number: null, title: 'INTERNAL Brand refresh retainer', status: 'todo', score: 0.97 }]

/** Everything studio side that must never reach the client's DM. */
const STUDIO_ONLY = [
  'INTERNAL', '/tasks', 'Tweak', 'Tonight', 'This week', 'Snoozed', 'Liam', 'Staci', 'Looks like', 'Approve anyway',
  'Use ', 'D1_ERROR', 'Could not apply', 'Suggested:', 'owns the brand', '#240',
]

const TIM = {
  id: 'si_tim', slackTeamId: 'T1', slackUserId: 'U_TIM', email: 'tim@verandela.test',
  level: 'client' as const, teamMemberId: null, contactId: 'c_tim', orgId: 'o_ver', dmChannelId: 'D_TIM',
}

/** The static text and bound values of a drizzle `sql` template. */
function renderSql(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
  let text = ''
  const params: unknown[] = []
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown }).value
    if (Array.isArray(value) && value.every(part => typeof part === 'string')) text += value.join('')
    else params.push(chunk)
  }
  return { text, params }
}

/** A database with a copy of Tim's card ON FILE, the worst case. `requests`
 *  is the feature_visibility answer for his client's Requests feature. */
function database(options: { requests?: 'allow' | 'deny' } = {}) {
  const writes: string[] = []
  const rows = (table: unknown): Array<Record<string, unknown>> => {
    if (table === schema.contacts) return [{ id: 'c_tim', orgId: 'o_ver', name: 'Tim Lyons', portalRole: 'member', isPrimary: false }]
    if (table === schema.teamMembers) return [{ name: 'Liam Miller', clerkUserId: 'clerk_liam' }]
    if (table === schema.requests) return [{ requestNumber: 231, isInternal: false, orgId: 'o_ver' }]
    if (table === schema.featureVisibility && options.requests) return [{ featureKey: 'requests', effect: options.requests }]
    return []
  }
  const db = {
    all: async (query: unknown) => {
      const { text } = renderSql(query)
      if (text.includes('FROM slack_suggestion_messages')) return [{ suggestion_id: 's1', channel_id: 'D_TIM', ts: '1758500000.0042' }]
      return []
    },
    run: async (query: unknown) => {
      writes.push(renderSql(query).text)
      return {}
    },
    select: () => ({
      from: (table: unknown) => {
        const node: Record<string, unknown> = {}
        node.where = () => node
        node.limit = () => node
        node.then = <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(rows(table)).then(resolve)
        return node
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return { db: db as never, writes }
}

function timsDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1', orgId: 'o_ver', kind: 'create_request', status: 'pending',
    approverType: 'contact', approverId: 'c_tim',
    proposal: JSON.stringify({ title: 'New footer icons', suggestedAssigneeName: 'Staci', assigneeReason: 'owns the brand work' }),
    quote: 'Can we get new footer icons?',
    snoozeUntil: null, decidedById: null, decidedAt: null, updatedAt: '2026-09-22T21:41:00Z', applyError: null,
    appliedTaskId: null, appliedRequestId: null,
    orgName: 'Verandela', callTitle: null, callScheduledAt: null,
    ...overrides,
  }
}

function press(action: string) {
  return {
    identity: TIM,
    payload: {
      actionId: `sugg:${action}:s1`, value: null, slackUserId: 'U_TIM', slackTeamId: 'T1',
      channelId: 'D_TIM', messageTs: '1758500000.0042',
    },
  }
}

/** Every Slack call that landed in Tim's DM, as one string to search. */
function timsDm(): string {
  return JSON.stringify(slackCalls.filter(call => call.channel === 'D_TIM'))
}

function expectClientSafe(): void {
  const sent = timsDm()
  for (const phrase of STUDIO_ONLY) expect(sent, `the client's DM must not contain "${phrase}"`).not.toContain(phrase)
}

beforeEach(() => {
  slackCalls.length = 0
  decisions.length = 0
  decideChanged = true
  storedRow = timsDraft()
  decidedRow = timsDraft()
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the client's own press", () => {
  it('approve: one rewrite of the pressed card in client wording, a link to their own request, no copy filed', async () => {
    decidedRow = timsDraft({
      status: 'applied', decidedById: 'c_tim', decidedAt: '2026-09-22T21:41:00Z', appliedRequestId: 'r_new',
    })
    const { db, writes } = database()
    const result = await handleSuggestionAction({ drizzle: db, ...press('approve') })
    expect(result).toEqual({ handled: true, reply: null })
    expect(decisions).toEqual([{ action: 'approve', force: true }])
    expect(slackCalls).toEqual([{
      method: 'update', channel: 'D_TIM', ts: '1758500000.0042', text: 'Approved by Tim, 09:41',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Approved by Tim, 09:41 · <https://portal.tahi.studio/requests/r_new|Open #231>' } }],
    }])
    expect(writes.some(text => text.includes('slack_suggestion_messages'))).toBe(false)
    expectClientSafe()
  })

  it('approve that fails to apply: one plain sentence, never the apply error', async () => {
    decidedRow = timsDraft({ status: 'failed', decidedById: 'c_tim', decidedAt: '2026-09-22T21:41:00Z', applyError: 'D1_ERROR: no such column: org_id' })
    const { db } = database()
    await handleSuggestionAction({ drizzle: db, ...press('approve') })
    expect(slackCalls.map(call => call.text)).toEqual(['Could not file this request just now. The studio can see it on their side.'])
    expectClientSafe()
  })

  it('reject: one rewrite naming the client', async () => {
    decidedRow = timsDraft({ status: 'rejected', decidedById: 'c_tim', decidedAt: '2026-09-22T21:41:00Z' })
    const { db } = database()
    await handleSuggestionAction({ drizzle: db, ...press('reject') })
    expect(slackCalls.map(call => [call.method, call.channel, call.text])).toEqual([['update', 'D_TIM', 'Rejected by Tim, 09:41']])
    expectClientSafe()
  })

  it('approve with Requests denied for their client: the plain refusal, nothing decided, nothing written to Slack', async () => {
    const { db } = database({ requests: 'deny' })
    const result = await handleSuggestionAction({ drizzle: db, ...press('approve') })
    expect(result.reply).toBe(SLACK_DENIED_LINE)
    expect(decisions).toEqual([])
    expect(slackCalls).toEqual([])
  })

  it('Tonight and This week: refused, nothing decided, nothing written to Slack', async () => {
    const { db } = database()
    const tonight = await handleSuggestionAction({ drizzle: db, ...press('snooze_tonight') })
    const week = await handleSuggestionAction({ drizzle: db, ...press('snooze_week') })
    expect([tonight.reply, week.reply]).toEqual([SLACK_DENIED_LINE, SLACK_DENIED_LINE])
    expect(decisions).toEqual([])
    expect(slackCalls).toEqual([])
  })

  it('a second press after the studio decided: the plain line, and the card rewritten naming nobody', async () => {
    decideChanged = false
    decidedRow = timsDraft({ status: 'rejected', decidedById: 'tm_liam', decidedAt: '2026-09-22T21:41:00Z' })
    const { db } = database()
    const result = await handleSuggestionAction({ drizzle: db, ...press('approve') })
    expect(result.reply).toBe('That one was already decided.')
    expect(slackCalls.map(call => call.text)).toEqual(['Not filed, 09:41'])
    expectClientSafe()
  })
})

describe('the studio side never reaches the client DM', () => {
  it('a studio decision on the client draft (the decide hook) writes nothing to Slack', async () => {
    const { db } = database()
    const studioDecisions = [
      timsDraft({ status: 'snoozed', decidedById: 'tm_liam', snoozeUntil: '2026-09-25T21:00:00Z' }),
      timsDraft({ status: 'rejected', decidedById: 'tm_liam', decidedAt: '2026-09-22T21:41:00Z' }),
      timsDraft({ status: 'failed', decidedById: 'tm_liam', decidedAt: '2026-09-22T21:41:00Z', applyError: 'D1_ERROR: boom' }),
      timsDraft({ status: 'applied', decidedById: 'tm_liam', decidedAt: '2026-09-22T21:41:00Z', kind: 'note', appliedTaskId: 't_int' }),
    ]
    for (const row of studioDecisions) {
      expect(await mirrorSuggestionDecision(db, row as never)).toBe(0)
    }
    expect(slackCalls).toEqual([])
  })

  it('a snooze on the client draft coming back (the repost) writes nothing to Slack', async () => {
    const { db } = database()
    const row = { ...timsDraft(), proposal: JSON.parse(String(timsDraft().proposal)), similar: SIMILAR }
    expect(await repostSuggestion(db, row as never)).toBe(0)
    expect(slackCalls).toEqual([])
  })

  it('the undecided re-render, duplicate answer and all, writes nothing to Slack', async () => {
    const { db } = database()
    const row = { ...timsDraft(), proposal: JSON.parse(String(timsDraft().proposal)), similar: SIMILAR }
    expect(await rewriteSuggestionMessage(db, row as never, { duplicate: true })).toBe(0)
    expect(await rewriteSuggestionMessage(db, row as never)).toBe(0)
    expect(slackCalls).toEqual([])
  })

  it('and a studio card still gets the studio line, so the fence is on the client row only', async () => {
    const { db } = database()
    await mirrorSuggestionDecision(db, {
      ...timsDraft({ status: 'rejected', decidedById: 'tm_liam', decidedAt: '2026-09-22T21:41:00Z' }),
      approverType: 'founders',
    } as never)
    expect(slackCalls.map(call => call.text)).toEqual(['Rejected by Liam, 09:41'])
  })
})

describe("the post-time card: two clients whose DMs open the same way (the key is the sender's)", () => {
  /** Every value bound in a drizzle condition, in order. */
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

  const CONTACTS: Record<string, Record<string, unknown>> = {
    c_tim: { id: 'c_tim', orgId: 'o_ver', name: 'Tim Lyons', portalRole: 'member', isPrimary: false },
    c_ngaire: { id: 'c_ngaire', orgId: 'o_ver', name: 'Ngaire Reid', portalRole: 'member', isPrimary: false },
    c_ana: { id: 'c_ana', orgId: 'o_ele', name: 'Ana Ruiz', portalRole: 'admin', isPrimary: true },
  }
  const ORGS: Record<string, string> = { o_ver: 'Verandela', o_ele: 'Elevate' }

  /**
   * One shared task_suggestions table, the way D1 holds it: a global UNIQUE
   * dedupe key. Every read of it answers with every row, a superset of any
   * WHERE, because insertSuggestions and readBack both re-check what they
   * read; a leak through either would show up here as another client's
   * words in a DM.
   */
  function sharedDb() {
    const suggestions: Array<Record<string, unknown>> = []
    const runs: string[] = []
    const rowsFor = (table: unknown, condition: unknown): Array<Record<string, unknown>> => {
      if (table === schema.taskSuggestions) return suggestions.map(row => ({ ...row }))
      if (table === schema.contacts) {
        const [id, orgId] = boundValues(condition)
        const contact = typeof id === 'string' ? CONTACTS[id] : undefined
        if (!contact || (orgId !== undefined && contact.orgId !== orgId)) return []
        return [contact]
      }
      if (table === schema.organisations) {
        const [id] = boundValues(condition)
        return typeof id === 'string' && ORGS[id] ? [{ id, name: ORGS[id] }] : []
      }
      return []
    }
    const db = {
      select: () => ({
        from: (table: unknown) => ({
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
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (suggestions.some(existing => existing.dedupeKey === row.dedupeKey)) {
            throw new Error('UNIQUE constraint failed: task_suggestions.dedupe_key')
          }
          suggestions.push({ ...row })
        },
      }),
      run: async (query: unknown) => {
        runs.push(renderSql(query).text)
        return {}
      },
    }
    return { db: db as never, suggestions, runs }
  }

  function client(contactId: string, orgId: string, channel: string) {
    return {
      id: `si_${contactId}`, slackTeamId: 'T1', slackUserId: `U_${contactId}`, email: `${contactId}@client.test`,
      level: 'client' as const, teamMemberId: null, contactId, orgId, dmChannelId: channel,
    }
  }

  const DMS = { tim: 'D_TIM', ngaire: 'D_NGAIRE', ana: 'D_ANA' }
  const TIMS_FOOTER = 'Hi team! Our new office is at 12 Main St, please add it to the footer.'
  const TIMS_BLOG = 'Hi team! Add a blog page for the autumn range.'
  const ANAS_FORM = 'Hi team! The contact form on the Elevate site is bouncing every enquiry.'

  async function dm(db: never, who: ReturnType<typeof client>, text: string) {
    return handleSlackDm(
      { teamId: 'T1', channelId: who.dmChannelId, userId: who.slackUserId, text, ts: '1758600000.0001' },
      {
        database: db,
        identity: who,
        postMessage: async (message: { channel: string; text: string; blocks?: unknown[] }) => {
          slackCalls.push({ method: 'post', channel: message.channel, text: message.text, blocks: [...(message.blocks ?? [])] })
          return { channel: message.channel, ts: `1758600000.10${slackCalls.length}` }
        },
      },
    )
  }

  function dmText(channel: string): string {
    return JSON.stringify(slackCalls.filter(call => call.channel === channel))
  }

  /** The suggestion ids the cards in one DM carry on their buttons. */
  function cardIds(channel: string): string[] {
    const ids = new Set<string>()
    for (const match of dmText(channel).matchAll(/sugg:approve:([\w-]+)/g)) ids.add(match[1])
    return [...ids]
  }

  it('files every ask, each under its sender, and shows each DM only its own words', async () => {
    const { db, suggestions, runs } = sharedDb()
    const tim = client('c_tim', 'o_ver', DMS.tim)
    const ngaire = client('c_ngaire', 'o_ver', DMS.ngaire)
    const ana = client('c_ana', 'o_ele', DMS.ana)

    await dm(db, tim, TIMS_FOOTER)
    await dm(db, ana, ANAS_FORM)
    await dm(db, tim, TIMS_BLOG)
    await dm(db, ngaire, TIMS_FOOTER)

    // Four asks, four rows: none swallowed as another's duplicate, or as
    // "similar" to another draft that opens with the same greeting.
    expect(suggestions.map(row => [row.approverId, row.orgId])).toEqual([
      ['c_tim', 'o_ver'], ['c_ana', 'o_ele'], ['c_tim', 'o_ver'], ['c_ngaire', 'o_ver'],
    ])
    expect(new Set(suggestions.map(row => row.dedupeKey)).size).toBe(4)

    // Each DM: the reply line, then a card for that sender's own rows only.
    const idsOf = (contactId: string) => suggestions.filter(row => row.approverId === contactId).map(row => row.id)
    expect(cardIds(DMS.tim)).toEqual(idsOf('c_tim'))
    expect(cardIds(DMS.ana)).toEqual(idsOf('c_ana'))
    expect(cardIds(DMS.ngaire)).toEqual(idsOf('c_ngaire'))

    expect(dmText(DMS.ana)).not.toContain('12 Main St')
    expect(dmText(DMS.ana)).not.toContain('blog page')
    expect(dmText(DMS.ana)).not.toContain('Verandela')
    expect(dmText(DMS.tim)).not.toContain('contact form')
    expect(dmText(DMS.tim)).not.toContain('Elevate')
    expect(dmText(DMS.tim)).toContain('blog page')
    expect(dmText(DMS.ngaire)).not.toContain('blog page')

    // And none of the client cards was filed as a copy.
    expect(runs.some(text => text.includes('slack_suggestion_messages'))).toBe(false)
  })

  it('shows a client who sends the same message twice the card already open, not a second row', async () => {
    const { db, suggestions } = sharedDb()
    const tim = client('c_tim', 'o_ver', DMS.tim)
    await dm(db, tim, TIMS_FOOTER)
    await dm(db, tim, TIMS_FOOTER)
    expect(suggestions).toHaveLength(1)
    expect(slackCalls.filter(call => call.text === NOTE_REPLY_CLIENT)).toHaveLength(2)
    expect(cardIds(DMS.tim)).toEqual([suggestions[0].id])
  })

  it("never shows a client another sender's row, even one already filed under their key", async () => {
    const { db, suggestions } = sharedDb()
    const tim = client('c_tim', 'o_ver', DMS.tim)
    const ana = client('c_ana', 'o_ele', DMS.ana)
    await dm(db, tim, TIMS_FOOTER)
    await dm(db, ana, ANAS_FORM)
    // The worst case: the row under the very key Ana's message hashes to is
    // somebody else's (an old key, a collision).
    const anasRow = suggestions.find(row => row.approverId === 'c_ana')!
    anasRow.approverId = 'c_tim'
    anasRow.orgId = 'o_ver'
    anasRow.quote = 'TIM PRIVATE words under the key'
    slackCalls.length = 0

    await dm(db, ana, ANAS_FORM)
    expect(dmText(DMS.ana)).not.toContain('TIM PRIVATE')
    expect(cardIds(DMS.ana)).toEqual([])
  })
})
