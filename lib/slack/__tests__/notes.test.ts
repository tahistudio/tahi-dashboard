/**
 * lib/slack/notes.ts, the path from "somebody typed a sentence into a DM" to
 * "a row is waiting for that same person to press a button" (CN.2 section 4).
 *
 * What is pinned here:
 *
 *   THE APPROVER, because a note is not a call. A call is decided by the
 *   founders; a note is decided by whoever wrote it, and filing one with
 *   approver_type 'founders' would quietly hand Liam an inbox of other
 *   people's half-thoughts.
 *
 *   THE ORG, because the whole point of resolving it from the text is that it
 *   is resolved EXACTLY or not at all. A note that names two clients names no
 *   client, and a suggestion filed under the wrong one is worse than a
 *   suggestion filed under none.
 *
 *   THE CLIENT PATH, which never reaches the model: a client's own words are
 *   the request, and paraphrasing them would mean asking them to approve a
 *   sentence they did not write.
 *
 *   THE CEILING, because three is the number in the contract and a DM that
 *   answers with nine cards is a DM nobody reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { schema } from '@/db/d1'
import type { SuggestionDraft } from '@/lib/task-suggestions'
import type { SuggestResult } from '@/lib/task-suggester'
import type { SlackIdentity } from '../identity'

const insertedDrafts: SuggestionDraft[][] = []
let insertResult = { inserted: 1, duplicates: 0, similarDropped: 0 }

vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  return {
    ...actual,
    insertSuggestions: async (_drizzle: unknown, drafts: readonly SuggestionDraft[]) => {
      insertedDrafts.push([...drafts])
      return insertResult
    },
  }
})

vi.mock('@/lib/task-suggester', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggester')>('@/lib/task-suggester')
  return {
    ...actual,
    buildSuggestionContext: async () => ({ tasks: [], requests: [], members: [], contacts: [] }),
  }
})

const { draftFromNote, resolveOrgFromText, MAX_NOTE_SUGGESTIONS, NOTE_REPLY_TEAM, NOTE_REPLY_CLIENT } =
  await import('../notes')
const { SLACK_DENIED_REPLY } = await import('../identity')

type Rows = Record<string, Array<Record<string, unknown>>>

const TABLE_KEYS = new Map<unknown, string>([
  [schema.taskSuggestions, 'task_suggestions'],
  [schema.organisations, 'organisations'],
  [schema.contacts, 'contacts'],
])

function fakeDb(rows: Rows) {
  const name = (table: unknown): string => TABLE_KEYS.get(table) ?? 'unknown'
  function reader(table: unknown) {
    const data = rows[name(table)] ?? []
    const node: Record<string, unknown> = {}
    node.where = () => node
    node.orderBy = () => node
    node.limit = () => node
    node.then = <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(data).then(resolve)
    return node
  }
  return {
    select: () => ({ from: (table: unknown) => reader(table) }),
  } as unknown as Parameters<typeof draftFromNote>[0]['database']
}

function identity(overrides: Partial<SlackIdentity> = {}): SlackIdentity {
  return {
    id: 'si1',
    slackTeamId: 'T1',
    slackUserId: 'U1',
    email: 'liam@tahi.studio',
    level: 'founder',
    teamMemberId: 'tm_liam',
    contactId: null,
    orgId: null,
    dmChannelId: 'D1',
    ...overrides,
  }
}

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'create_task' as const,
    targetTaskId: null,
    targetRequestId: null,
    proposal: { title: 'Send the font headers', type: 'internal_client_task' } as Record<string, unknown>,
    quote: 'I will send the font headers to Giant Group',
    rationale: null,
    confidence: 0.6,
    ...overrides,
  }
}

function suggesterReturning(suggestions: ReturnType<typeof suggestion>[]): () => Promise<SuggestResult> {
  return async () => ({
    suggestions,
    dropped: [],
    usage: { model: 'test', inputTokens: 0, outputTokens: 0 },
  })
}

const ORGS = [
  { id: 'o_giant', name: 'Giant Group', status: 'active' },
  { id: 'o_kiwi', name: 'Kiwi Labs', status: 'active' },
]

beforeEach(() => {
  insertedDrafts.length = 0
  insertResult = { inserted: 1, duplicates: 0, similarDropped: 0 }
})

describe('resolveOrgFromText', () => {
  it('resolves a client named exactly once', () => {
    expect(resolveOrgFromText('I will send the font headers to Giant Group', ORGS)).toBe('o_giant')
  })

  it('is case blind', () => {
    expect(resolveOrgFromText('ping giant group about the headers', ORGS)).toBe('o_giant')
  })

  it('refuses to guess when two clients are named', () => {
    expect(resolveOrgFromText('Giant Group and Kiwi Labs both want the deck', ORGS)).toBeNull()
  })

  it('prefers the longer name when one client name contains another', () => {
    const nested = [{ id: 'o_giant', name: 'Giant Group' }, { id: 'o_g', name: 'Giant' }]
    expect(resolveOrgFromText('a note about Giant Group', nested)).toBe('o_giant')
  })

  it('returns null when nobody is named', () => {
    expect(resolveOrgFromText('remember to renew the domain', ORGS)).toBeNull()
  })

  it('does not match a name inside a longer word', () => {
    expect(resolveOrgFromText('the kiwilabsomething repo', [{ id: 'o_kiwi', name: 'Kiwi Labs' }])).toBeNull()
  })
})

describe('draftFromNote, a team member', () => {
  it('files the sender as the approver and resolves the org from the text', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'I will send the font headers to Giant Group',
      identity: identity({ level: 'member', teamMemberId: 'tm_staci' }),
      suggest: suggesterReturning([suggestion()]),
    })

    expect(result.ok).toBe(true)
    expect(result.reply).toBe(NOTE_REPLY_TEAM)
    expect(insertedDrafts).toHaveLength(1)
    const draft = insertedDrafts[0][0]
    expect(draft.approverType).toBe('member')
    expect(draft.approverId).toBe('tm_staci')
    expect(draft.sourceKind).toBe('note')
    expect(draft.transcriptId).toBeNull()
    expect(draft.callId).toBeNull()
    expect(draft.orgId).toBe('o_giant')
  })

  it('files studio housekeeping with no org when the note names no client', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    await draftFromNote({
      database,
      text: 'remember to renew the domain before it lapses',
      identity: identity(),
      suggest: suggesterReturning([suggestion({ quote: 'remember to renew the domain before it lapses' })]),
    })
    expect(insertedDrafts[0][0].orgId).toBeNull()
  })

  it('keeps at most three suggestions from one note', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const many = [1, 2, 3, 4, 5].map(n => suggestion({ proposal: { title: `Thing ${n}`, type: 'tahi_internal' } }))
    await draftFromNote({
      database,
      text: 'five things',
      identity: identity(),
      suggest: suggesterReturning(many),
    })
    expect(insertedDrafts[0]).toHaveLength(MAX_NOTE_SUGGESTIONS)
  })

  it('says so rather than filing nothing silently when the model found no work', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'hello',
      identity: identity(),
      suggest: suggesterReturning([]),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nothing_understood')
    expect(result.reply.length).toBeGreaterThan(0)
    expect(insertedDrafts).toHaveLength(0)
  })

  it('records a suggester failure rather than throwing at the DM', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'something',
      identity: identity(),
      suggest: async () => { throw new Error('no key') },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('suggester_failed')
    expect(insertedDrafts).toHaveLength(0)
  })
})

describe('draftFromNote, a client', () => {
  it('drafts one request on their own org with them as the requester', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    let modelCalled = false
    const result = await draftFromNote({
      database,
      text: 'Can you change the hero image on the homepage to the new one we sent.',
      identity: identity({
        level: 'client',
        email: 'ngaire@giant.example',
        teamMemberId: null,
        contactId: 'c_ngaire',
        orgId: 'o_giant',
      }),
      contactName: 'Ngaire Reid',
      suggest: async () => { modelCalled = true; throw new Error('the client path must not call the model') },
    })

    expect(modelCalled).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.reply).toBe(NOTE_REPLY_CLIENT)
    const draft = insertedDrafts[0][0]
    expect(draft.kind).toBe('create_request')
    expect(draft.orgId).toBe('o_giant')
    expect(draft.approverType).toBe('contact')
    expect(draft.approverId).toBe('c_ngaire')
    const proposal = draft.proposal as Record<string, unknown>
    expect(proposal.requesterContactId).toBe('c_ngaire')
    expect(proposal.requesterName).toBe('Ngaire Reid')
    expect(String(proposal.description)).toContain('hero image')
    expect(draft.quote).toContain('hero image')
  })

  it('never files a client draft under another client named in the text', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    await draftFromNote({
      database,
      text: 'Kiwi Labs told us to ask you for the new deck',
      identity: identity({ level: 'client', teamMemberId: null, contactId: 'c_ngaire', orgId: 'o_giant' }),
    })
    expect(insertedDrafts[0][0].orgId).toBe('o_giant')
  })

  it('refuses a client with no org rather than filing a homeless request', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'please change the hero image',
      identity: identity({ level: 'client', teamMemberId: null, contactId: 'c_x', orgId: null }),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('denied')
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(insertedDrafts).toHaveLength(0)
  })
})

describe('draftFromNote, everybody else', () => {
  it('answers an unknown Slack user with one plain sentence and writes nothing', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'hi, can you tell me what Giant Group is working on',
      identity: identity({ level: 'unknown', teamMemberId: null, email: null }),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('denied')
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(result.reply.split('.').filter(Boolean)).toHaveLength(1)
    expect(insertedDrafts).toHaveLength(0)
  })

  it('answers a DM with no identity at all the same way', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({ database, text: 'hello', identity: null })
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(insertedDrafts).toHaveLength(0)
  })

  it('ignores an empty note without answering at all', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({ database, text: '   ', identity: identity() })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('empty')
    expect(result.reply).toBe('')
  })
})
