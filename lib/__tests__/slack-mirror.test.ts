/**
 * lib/slack/mirror.ts, the Slack copies of one suggestion.
 *
 * What is pinned here:
 *
 *   BOTH FOUNDERS GET ONE. A call's suggestions go to Liam and to Staci, so
 *   one row has two messages in two channels, and the copies table is what
 *   makes the pair findable later.
 *
 *   NOTHING HERE FAILS ITS CALLER. The sweep writes suggestions whether or
 *   not Slack is installed, reachable, or migrated. Every failure in this
 *   module is counted, never thrown (CN.2 contract section 3).
 *
 *   ONE COPY PER SUGGESTION PER RUN. The sweep re-reads the pending rows for
 *   a call, so a row that already has a copy must not be posted twice, or a
 *   founder's DM fills up with the same suggestion every thirty minutes.
 *
 *   THE APPROVED CARD POINTS AT WHAT IT MADE (CN.3 section 1). "Approved by
 *   Liam, 09:41 · Open #231", because the card is the parent of the thread
 *   the later changes reply in. A number that cannot be read is "Open
 *   request", never a throw, and only an approval carries a link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { schema } from '@/db/d1'

const posted: Array<{ channel: string; text: string; blocks: unknown[] }> = []
const updated: Array<{ channel: string; ts: string; text: string; blocks: unknown[] }> = []
const openedDms: string[] = []

let postFails: (channel: string) => boolean = () => false
let updateFails: (channel: string) => boolean = () => false
let openDmFails = false
let ts = 0

vi.mock('@/lib/slack/api', () => ({
  slackBotToken: () => process.env.SLACK_BOT_TOKEN ?? null,
  postMessage: async (input: { channel: string; text: string; blocks?: readonly unknown[] }) => {
    if (postFails(input.channel)) throw new Error('slack chat.postMessage: channel_not_found')
    posted.push({ channel: input.channel, text: input.text, blocks: [...(input.blocks ?? [])] })
    ts += 1
    return { channel: input.channel, ts: `1758500000.000${ts}` }
  },
  updateMessage: async (input: { channel: string; ts: string; text: string; blocks?: readonly unknown[] }) => {
    if (updateFails(input.channel)) throw new Error('slack chat.update: message_not_found')
    updated.push({ channel: input.channel, ts: input.ts, text: input.text, blocks: [...(input.blocks ?? [])] })
  },
  openDm: async (userId: string) => {
    if (openDmFails) throw new Error('slack conversations.open: user_not_found')
    openedDms.push(userId)
    return `D_${userId.replace(/^U_/, '')}`
  },
}))

const {
  decidedLinkFor,
  listSuggestionMessages,
  mirrorSuggestionDecision,
  outcomeForStatus,
  postSuggestionsForCall,
  recordSuggestionMessage,
  repostSuggestion,
  rewriteEverywhere,
  rewriteSuggestionMessage,
  studioClock,
} = await import('../slack/mirror')

const LIAM = {
  id: 'si1', slackTeamId: 'T1', slackUserId: 'U_LIAM', email: 'liam@tahi.studio',
  level: 'founder' as const, teamMemberId: 'tm_liam', contactId: null, orgId: null, dmChannelId: 'D_LIAM',
}
const STACI = {
  id: 'si2', slackTeamId: 'T1', slackUserId: 'U_STACI', email: 'staci@tahi.studio',
  level: 'founder' as const, teamMemberId: 'tm_staci', contactId: null, orgId: null, dmChannelId: null,
}

interface CopyRow { suggestion_id: string; channel_id: string; ts: string }

/** The raw text and bound values of a drizzle `sql` template, which is how
 *  the fake tells a copies read from a copies write. */
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

interface FakeDbOptions {
  copies?: CopyRow[]
  members?: Array<{ id: string; name: string }>
  contacts?: Array<{ id: string; name: string }>
  requests?: Array<{ id: string; requestNumber: number | null }>
  requestReadFails?: boolean
  tableMissing?: boolean
}

/** A database that answers each Drizzle select by the table it names and
 *  ignores the WHERE: every test hands it only the rows it means. */
function fakeDb(options: FakeDbOptions = {}) {
  const copies = options.copies ?? []
  const members = options.members ?? [{ id: 'tm_liam', name: 'Liam Miller' }]
  const contacts = options.contacts ?? []
  const requests = options.requests ?? []
  const stamped: Array<Record<string, unknown>> = []

  function rowsFor(table: unknown): Array<Record<string, unknown>> {
    if (table === schema.teamMembers) return members
    if (table === schema.contacts) return contacts
    if (table === schema.requests) return requests
    return []
  }

  const database = {
    all: async (query: unknown) => {
      if (options.tableMissing) throw new Error('no such table: slack_suggestion_messages')
      const { text, params } = renderSql(query)
      if (text.includes('FROM slack_suggestion_messages')) {
        const id = params[0]
        return copies.filter(copy => copy.suggestion_id === id)
      }
      return []
    },
    run: async (query: unknown) => {
      if (options.tableMissing) throw new Error('no such table: slack_suggestion_messages')
      const { text, params } = renderSql(query)
      if (text.includes('INTO slack_suggestion_messages')) {
        const [, suggestionId, channelId, messageTs] = params as string[]
        if (!copies.some(copy => copy.suggestion_id === suggestionId && copy.channel_id === channelId && copy.ts === messageTs)) {
          copies.push({ suggestion_id: suggestionId, channel_id: channelId, ts: messageTs })
        }
      }
      return {}
    },
    select: () => ({
      from: (table: unknown) => {
        const node: Record<string, unknown> = {}
        node.where = () => node
        node.limit = () => node
        node.then = <T>(resolve: (value: Array<Record<string, unknown>>) => T, reject?: (reason: unknown) => T) => {
          if (table === schema.requests && options.requestReadFails) {
            return Promise.reject(new Error('D1_ERROR: no such column')).then(resolve, reject)
          }
          return Promise.resolve(rowsFor(table)).then(resolve, reject)
        }
        return node
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { stamped.push(values) },
      }),
    }),
  }

  return { database: database as unknown as Parameters<typeof listSuggestionMessages>[0], copies, stamped }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    kind: 'create_task',
    proposal: { title: 'Cut the hero video', assigneeName: 'Staci', assigneeReason: 'said she would do it' },
    quote: 'We still need the hero video cut to thirty seconds.',
    confidence: 0.82,
    orgName: 'Nga Motu',
    callTitle: 'Kickoff call',
    callScheduledAt: '2026-09-18T20:00:00Z',
    similar: [],
    ...overrides,
  }
}

beforeEach(() => {
  posted.length = 0
  updated.length = 0
  openedDms.length = 0
  postFails = () => false
  updateFails = () => false
  openDmFails = false
  ts = 0
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the copies table', () => {
  it('remembers a copy and reads it back', async () => {
    const { database, copies } = fakeDb()
    expect(await recordSuggestionMessage(database, { suggestionId: 's1', channelId: 'D_LIAM', ts: '1.1' })).toBe(true)
    expect(copies).toEqual([{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }])
    expect(await listSuggestionMessages(database, 's1')).toEqual([{ suggestionId: 's1', channelId: 'D_LIAM', ts: '1.1' }])
  })

  it('files nothing for a message with no channel or timestamp', async () => {
    const { database, copies } = fakeDb()
    expect(await recordSuggestionMessage(database, { suggestionId: 's1', channelId: '', ts: '1.1' })).toBe(false)
    expect(copies).toHaveLength(0)
  })

  it('reads as empty before migration 0110 has run, rather than throwing', async () => {
    const { database } = fakeDb({ tableMissing: true })
    expect(await listSuggestionMessages(database, 's1')).toEqual([])
    expect(await recordSuggestionMessage(database, { suggestionId: 's1', channelId: 'D', ts: '1.1' })).toBe(false)
  })
})

describe('rewriteEverywhere', () => {
  it('rewrites both founders copies of the one row', async () => {
    const { database } = fakeDb({ copies: [
      { suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' },
      { suggestion_id: 's1', channel_id: 'D_STACI', ts: '2.2' },
    ] })
    const count = await rewriteEverywhere(database, 's1', { text: 'Approved by Liam, 09:41', blocks: [] })
    expect(count).toBe(2)
    expect(updated.map(u => u.channel)).toEqual(['D_LIAM', 'D_STACI'])
  })

  it('keeps going when one channel refuses the edit', async () => {
    updateFails = channel => channel === 'D_LIAM'
    const { database } = fakeDb({ copies: [
      { suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' },
      { suggestion_id: 's1', channel_id: 'D_STACI', ts: '2.2' },
    ] })
    expect(await rewriteEverywhere(database, 's1', { text: 'Rejected by Staci, 09:42', blocks: [] })).toBe(1)
  })

  it('does nothing at all without a bot token', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    expect(await rewriteEverywhere(database, 's1', { text: 'x', blocks: [] })).toBe(0)
    expect(updated).toHaveLength(0)
  })
})

describe('posting a call to the founders', () => {
  it('posts a header and one message per suggestion, to every founder', async () => {
    const { database } = fakeDb()
    const result = await postSuggestionsForCall(database, {
      rows: [row(), row({ id: 's2', kind: 'note', proposal: { body: 'They liked the second direction.' } })],
      founders: [LIAM, STACI],
    })
    expect(result).toEqual({ posted: 4, failed: 0, founders: 2 })
    expect(posted).toHaveLength(6)
    expect(posted[0].text).toContain('2 suggestions')
    expect(posted.map(p => p.channel)).toEqual(['D_LIAM', 'D_LIAM', 'D_LIAM', 'D_STACI', 'D_STACI', 'D_STACI'])
  })

  it('opens a DM for a founder with no cached channel', async () => {
    const { database } = fakeDb()
    await postSuggestionsForCall(database, { rows: [row()], founders: [STACI] })
    expect(openedDms).toEqual(['U_STACI'])
  })

  it('files every copy, so either founder can rewrite both', async () => {
    const { database, copies } = fakeDb()
    await postSuggestionsForCall(database, { rows: [row()], founders: [LIAM, STACI] })
    expect(copies).toEqual([
      { suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1758500000.0002' },
      { suggestion_id: 's1', channel_id: 'D_STACI', ts: '1758500000.0004' },
    ])
  })

  it('stamps the first copy onto the row, which is the pointer CN.1 reserved', async () => {
    const { database, stamped } = fakeDb()
    await postSuggestionsForCall(database, { rows: [row()], founders: [LIAM, STACI] })
    expect(stamped).toEqual([{ slackChannelId: 'D_LIAM', slackMessageTs: '1758500000.0002' }])
  })

  it('skips a row that already has a copy, so a re-read does not post it twice', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    const result = await postSuggestionsForCall(database, {
      rows: [row(), row({ id: 's2', proposal: { title: 'Send the font licences' } })],
      founders: [LIAM],
    })
    expect(result.posted).toBe(1)
    expect(posted.filter(p => p.text.includes('Cut the hero video'))).toHaveLength(0)
    expect(posted.filter(p => p.text.includes('Send the font licences'))).toHaveLength(1)
    expect(posted[0].text).toContain('1 suggestion from Kickoff call')
  })

  it('counts a founder whose DM cannot be opened and still reaches the other', async () => {
    openDmFails = true
    const { database } = fakeDb()
    const result = await postSuggestionsForCall(database, { rows: [row()], founders: [LIAM, STACI] })
    expect(result.founders).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.posted).toBe(1)
  })

  it('posts nothing and reports nothing without a bot token', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const { database } = fakeDb()
    expect(await postSuggestionsForCall(database, { rows: [row()], founders: [LIAM] }))
      .toEqual({ posted: 0, failed: 0, founders: 0 })
  })

  it('posts nothing when the app knows no founders yet', async () => {
    const { database } = fakeDb()
    expect(await postSuggestionsForCall(database, { rows: [row()], founders: [] }))
      .toEqual({ posted: 0, failed: 0, founders: 0 })
  })
})

describe('reposting a resurfaced row', () => {
  it('posts a fresh message to every channel that held a copy', async () => {
    const { database } = fakeDb({ copies: [
      { suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' },
      { suggestion_id: 's1', channel_id: 'D_STACI', ts: '2.2' },
    ] })
    expect(await repostSuggestion(database, row())).toBe(2)
    expect(posted.map(p => p.channel)).toEqual(['D_LIAM', 'D_STACI'])
  })

  it('posts nothing for a row that was never in Slack', async () => {
    const { database } = fakeDb()
    expect(await repostSuggestion(database, row())).toBe(0)
  })
})

describe('the decided rewrite', () => {
  const decided = {
    id: 's1', status: 'applied', snoozeUntil: null, decidedById: 'tm_liam',
    decidedAt: '2026-09-22T21:41:00Z', updatedAt: '2026-09-22T21:41:00Z', applyError: null,
  }

  it('names the founder and the studio clock time', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    expect(await mirrorSuggestionDecision(database, decided)).toBe(1)
    expect(updated[0].text).toBe('Approved by Liam, 09:41')
  })

  it('says until when for a snooze', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    await mirrorSuggestionDecision(database, { ...decided, status: 'snoozed', snoozeUntil: '2026-09-25T21:00:00Z' })
    expect(updated[0].text).toMatch(/^Snoozed by Liam until /)
  })

  it('says what did not land for a failed apply', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    await mirrorSuggestionDecision(database, { ...decided, status: 'failed', applyError: 'Task not found' })
    expect(updated[0].text).toBe('Could not apply: Task not found')
  })

  it('keeps the apply error off a client draft card', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_TIM', ts: '1.1' }] })
    await mirrorSuggestionDecision(database, {
      ...decided, status: 'failed', approverType: 'contact', applyError: 'D1_ERROR: no such column: org_id',
    })
    expect(updated[0].text).toBe('Could not apply')
    expect(JSON.stringify(updated[0].blocks)).not.toContain('D1_ERROR')
  })

  it('leaves a pending row alone, because pending is not a decision', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    expect(await mirrorSuggestionDecision(database, { ...decided, status: 'pending' })).toBe(0)
    expect(updated).toHaveLength(0)
  })

  it('says someone when the actor cannot be named', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }], members: [] })
    await mirrorSuggestionDecision(database, decided)
    expect(updated[0].text).toBe('Approved by someone, 09:41')
  })

  it('returns 0 rather than throwing when the whole read fails', async () => {
    const { database } = fakeDb({ tableMissing: true })
    expect(await mirrorSuggestionDecision(database, decided)).toBe(0)
  })

  it('maps a row status to the word the message carries', () => {
    expect(outcomeForStatus('applied')).toBe('approved')
    expect(outcomeForStatus('rejected')).toBe('rejected')
    expect(outcomeForStatus('snoozed')).toBe('snoozed')
    expect(outcomeForStatus('expired')).toBe('expired')
    expect(outcomeForStatus('failed')).toBe('failed')
    expect(outcomeForStatus('pending')).toBeNull()
  })

  it('reads the studio wall clock, not UTC', () => {
    expect(studioClock('2026-09-22T21:41:00Z')).toBe('09:41')
    expect(studioClock(null)).toBeNull()
    expect(studioClock('not a date')).toBeNull()
  })
})

describe('the approved card links to what it made', () => {
  const COPY = [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }]
  const approved = {
    id: 's1', status: 'applied', snoozeUntil: null, decidedById: 'tm_liam',
    decidedAt: '2026-09-22T21:41:00Z', updatedAt: '2026-09-22T21:41:00Z', applyError: null,
  }

  function sectionText(index = 0): string {
    const block = updated[index].blocks[0] as { type: string; text: { text: string } }
    return block.text.text
  }

  it('links an approved task row to the task', async () => {
    const { database } = fakeDb({ copies: COPY })
    expect(await mirrorSuggestionDecision(database, {
      ...approved, kind: 'create_task', appliedTaskId: 't_new', appliedRequestId: null,
    })).toBe(1)
    expect(updated[0].text).toBe('Approved by Liam, 09:41')
    expect(sectionText()).toBe('Approved by Liam, 09:41 · <https://portal.tahi.studio/tasks/t_new|Open task>')
  })

  it('links an approved request row by its number', async () => {
    const { database } = fakeDb({ copies: COPY, requests: [{ id: 'r_new', requestNumber: 231 }] })
    await mirrorSuggestionDecision(database, {
      ...approved, kind: 'create_request', appliedTaskId: null, appliedRequestId: 'r_new',
    })
    expect(updated[0].text).toBe('Approved by Liam, 09:41')
    expect(sectionText()).toBe('Approved by Liam, 09:41 · <https://portal.tahi.studio/requests/r_new|Open #231>')
  })

  it('still links the request, as Open request, when its number cannot be read', async () => {
    const { database } = fakeDb({ copies: COPY, requestReadFails: true })
    expect(await mirrorSuggestionDecision(database, {
      ...approved, kind: 'hand_off_request', appliedTaskId: null, appliedRequestId: 'r_new',
    })).toBe(1)
    expect(sectionText()).toBe('Approved by Liam, 09:41 · <https://portal.tahi.studio/requests/r_new|Open request>')
  })

  it('says Open request for a request with no number yet', async () => {
    const { database } = fakeDb({ copies: COPY, requests: [{ id: 'r_new', requestNumber: null }] })
    await mirrorSuggestionDecision(database, { ...approved, kind: 'update_request', appliedRequestId: 'r_new' })
    expect(sectionText()).toContain('|Open request>')
  })

  it('carries no link on a rejected or a snoozed card, whatever the row names', async () => {
    const { database } = fakeDb({ copies: COPY })
    await mirrorSuggestionDecision(database, { ...approved, status: 'rejected', kind: 'update_task', appliedTaskId: 't1' })
    await mirrorSuggestionDecision(database, {
      ...approved, status: 'snoozed', snoozeUntil: '2026-09-25T21:00:00Z', kind: 'update_task', appliedTaskId: 't1',
    })
    expect(sectionText(0)).toBe('Rejected by Liam, 09:41')
    expect(sectionText(1)).not.toContain('<')
  })

  it('carries no link on an approved row that names nothing', async () => {
    const { database } = fakeDb({ copies: COPY })
    await mirrorSuggestionDecision(database, { ...approved, kind: 'note', appliedTaskId: null, appliedRequestId: null })
    expect(sectionText()).toBe('Approved by Liam, 09:41')
  })

  it('names a client who confirmed their own request by first name', async () => {
    const { database } = fakeDb({ copies: COPY, members: [], contacts: [{ id: 'c_tim', name: 'Tim Lyons' }] })
    await mirrorSuggestionDecision(database, { ...approved, decidedById: 'c_tim' })
    expect(updated[0].text).toBe('Approved by Tim, 09:41')
  })

  it('prefers the team member when both could answer', async () => {
    const { database } = fakeDb({ copies: COPY, contacts: [{ id: 'c_tim', name: 'Tim Lyons' }] })
    await mirrorSuggestionDecision(database, approved)
    expect(updated[0].text).toBe('Approved by Liam, 09:41')
  })

  it('picks the link by kind', async () => {
    const { database } = fakeDb({ requests: [{ id: 'r1', requestNumber: 7 }] })
    expect(await decidedLinkFor(database, { status: 'applied', kind: 'complete_task', appliedTaskId: 't1', appliedRequestId: null }))
      .toEqual({ url: 'https://portal.tahi.studio/tasks/t1', label: 'Open task' })
    expect(await decidedLinkFor(database, { status: 'applied', kind: 'request_note', appliedTaskId: null, appliedRequestId: 'r1' }))
      .toEqual({ url: 'https://portal.tahi.studio/requests/r1', label: 'Open #7' })
    expect(await decidedLinkFor(database, { status: 'applied', appliedRequestId: 'r1' }))
      .toEqual({ url: 'https://portal.tahi.studio/requests/r1', label: 'Open #7' })
    expect(await decidedLinkFor(database, { status: 'failed', kind: 'create_task', appliedTaskId: 't1' })).toBeNull()
    expect(await decidedLinkFor(database, { status: 'pending', kind: 'create_task', appliedTaskId: 't1' })).toBeNull()
  })
})

describe('the undecided rewrite', () => {
  it('re-renders the row with its buttons, which is what an attach needs', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    expect(await rewriteSuggestionMessage(database, row())).toBe(1)
    expect(updated[0].text).toContain('Cut the hero video')
  })

  it('re-renders with the duplicate answer when told to', async () => {
    const { database } = fakeDb({ copies: [{ suggestion_id: 's1', channel_id: 'D_LIAM', ts: '1.1' }] })
    await rewriteSuggestionMessage(
      database,
      row({ similar: [{ kind: 'request', id: 'r1', number: 226, title: 'Design directions', status: 'open', score: 0.91 }] }),
      { duplicate: true },
    )
    const blocks = JSON.stringify(updated[0].blocks)
    expect(blocks).toContain('Looks like #226 Design directions')
    expect(blocks).toContain('Approve anyway')
    expect(blocks).toContain('Use #226 instead')
  })
})

describe('the fake itself', () => {
  it('reads a drizzle sql template the way the fake claims to', () => {
    const { text, params } = renderSql(sql`SELECT 1 FROM t WHERE id = ${'x'}`)
    expect(text).toContain('FROM t WHERE id =')
    expect(params).toEqual(['x'])
  })
})
