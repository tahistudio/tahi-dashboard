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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const contextReads: Array<string | null> = []

vi.mock('@/lib/task-suggester', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggester')>('@/lib/task-suggester')
  return {
    ...actual,
    buildSuggestionContext: async (_database: unknown, orgId: string | null) => {
      contextReads.push(orgId)
      return { tasks: [], requests: [], members: [], contacts: [] }
    },
  }
})

/** Clerk user id to the clients that person reaches; null is everything. */
let scopeFor: (clerkUserId: string | null) => string[] | null = () => null
const scopeLookups: Array<string | null> = []
let grantedFeatures = new Set(['tasks', 'requests'])
let permissionFailure = false
let activeRoles = ['task_handler']

vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions')
  return {
    ...actual,
    resolvePermissions: async (_database: unknown, auth: { userId: string; orgId: string }) => {
      if (permissionFailure) throw new Error('permissions unavailable')
      return { ...auth, level: 'team_member', audience: 'team', isSuperAdmin: false, isAdmin: false,
        canManagePermissions: false, viewableResources: grantedFeatures, overrides: new Map() }
    },
  }
})

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async (_database: unknown, clerkUserId: string | null) => {
    scopeLookups.push(clerkUserId)
    return scopeFor(clerkUserId)
  },
}))

const {
  draftFromNote,
  resolveOrgFromText,
  MAX_NOTE_SUGGESTIONS,
  NOTE_REPLY_TEAM,
  NOTE_REPLY_CLIENT,
  NOTE_REPLY_CLIENT_ON_FILE,
  NOTE_REPLY_TEAM_ON_FILE,
} = await import('../notes')
const { SLACK_DENIED_REPLY } = await import('../identity')
const { buildDedupeKey } = await import('@/lib/task-suggestions')

type Rows = Record<string, Array<Record<string, unknown>>>

const TABLE_KEYS = new Map<unknown, string>([
  [schema.taskSuggestions, 'task_suggestions'],
  [schema.organisations, 'organisations'],
  [schema.contacts, 'contacts'],
  [schema.featureVisibility, 'feature_visibility'],
  [schema.teamMembers, 'team_members'],
  [schema.teamMemberRoles, 'team_member_roles'],
])

/** Ngaire's contacts row at Giant Group, which the portal gate reads. */
const NGAIRE = { id: 'c_ngaire', orgId: 'o_giant', name: 'Ngaire Reid', portalRole: 'member', isPrimary: false }

function fakeDb(rows: Rows) {
  rows = { team_members: [{ clerkUserId: 'clerk_studio' }], ...rows }
  const name = (table: unknown): string => TABLE_KEYS.get(table) ?? 'unknown'
  function reader(table: unknown) {
    const data = table === schema.teamMemberRoles ? activeRoles.map(name => ({ name })) : rows[name(table)] ?? []
    const node: Record<string, unknown> = {}
    node.where = () => node
    node.innerJoin = () => node
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
  contextReads.length = 0
  scopeLookups.length = 0
  scopeFor = () => null
  grantedFeatures = new Set(['tasks', 'requests'])
  permissionFailure = false
  activeRoles = ['task_handler']
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
})

afterEach(() => vi.unstubAllEnvs())

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
    const database = fakeDb({ organisations: ORGS, task_suggestions: [], contacts: [NGAIRE] })
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
    const database = fakeDb({ organisations: ORGS, task_suggestions: [], contacts: [NGAIRE] })
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

  const NGAIRE_ID = identity({ level: 'client', email: 'ngaire@giant.example', teamMemberId: null, contactId: 'c_ngaire', orgId: 'o_giant' })

  it('offers no card to a client whose Requests feature is denied for their org, as the portal refuses them', async () => {
    const database = fakeDb({
      organisations: ORGS,
      task_suggestions: [],
      contacts: [NGAIRE],
      feature_visibility: [{ featureKey: 'requests', effect: 'deny' }],
    })
    const result = await draftFromNote({ database, text: 'Can you change the hero image?', identity: NGAIRE_ID })
    expect(result.reason).toBe('denied')
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(result.rows).toEqual([])
    expect(insertedDrafts).toHaveLength(0)
  })

  it('offers no card to a contact the database does not place at that client', async () => {
    const database = fakeDb({ organisations: ORGS, task_suggestions: [], contacts: [] })
    const result = await draftFromNote({ database, text: 'Can you change the hero image?', identity: NGAIRE_ID })
    expect(result.reason).toBe('denied')
    expect(insertedDrafts).toHaveLength(0)
  })

  it("shows the sender's own pending draft read back by key, and never another contact's row under the same key", async () => {
    const text = 'Hi Liam! Can you change the hero image?'
    const key = await buildDedupeKey({
      sourceKind: 'note', transcriptId: null, kind: 'create_request', proposal: { title: 'Hi Liam!' },
      orgId: 'o_giant', approverType: 'contact', approverId: 'c_ngaire', quote: text,
    })
    const own = {
      id: 's_own', kind: 'create_request', proposal: JSON.stringify({ title: 'Hi Liam!' }), quote: text,
      dedupeKey: key, approverType: 'contact', approverId: 'c_ngaire', orgId: 'o_giant', status: 'pending',
    }
    const foreign = { ...own, id: 's_foreign', approverId: 'c_tama', quote: 'TAMA private words' }
    const otherClient = { ...own, id: 's_kiwi', orgId: 'o_kiwi', quote: 'KIWI private words' }
    const database = fakeDb({ organisations: ORGS, contacts: [NGAIRE], task_suggestions: [foreign, otherClient, own] })
    const result = await draftFromNote({ database, text, identity: NGAIRE_ID })
    expect(result.rows.map(row => row.id)).toEqual(['s_own'])
    expect(JSON.stringify(result.rows)).not.toContain('private words')
  })

  it('says so in one line when the same message was sent before and that draft is no longer open', async () => {
    insertResult = { inserted: 0, duplicates: 1, similarDropped: 0 }
    const text = 'Can you change the hero image?'
    const key = await buildDedupeKey({
      sourceKind: 'note', transcriptId: null, kind: 'create_request', proposal: { title: text },
      orgId: 'o_giant', approverType: 'contact', approverId: 'c_ngaire', quote: text,
    })
    const decided = {
      id: 's_old', kind: 'create_request', proposal: JSON.stringify({ title: text }), quote: text,
      dedupeKey: key, approverType: 'contact', approverId: 'c_ngaire', orgId: 'o_giant', status: 'applied',
    }
    const database = fakeDb({ organisations: ORGS, contacts: [NGAIRE], task_suggestions: [decided] })
    const result = await draftFromNote({ database, text, identity: NGAIRE_ID })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('already_on_file')
    expect(result.reply).toBe(NOTE_REPLY_CLIENT_ON_FILE)
    expect(result.rows).toEqual([])
  })
})

describe('draftFromNote, a studio note about a client the sender cannot reach (rule 11)', () => {
  const NATHAN = identity({ level: 'member', teamMemberId: 'tm_nathan', email: 'nathan@tahi.studio' })

  it('refuses before the model reads that client, and files nothing', async () => {
    scopeFor = () => ['o_kiwi']
    let modelCalled = false
    const database = fakeDb({ organisations: ORGS, task_suggestions: [], team_members: [{ clerkUserId: 'clerk_nathan' }] })
    const result = await draftFromNote({
      database,
      text: 'I will send the font headers to Giant Group',
      identity: NATHAN,
      suggest: async () => { modelCalled = true; throw new Error('must not be called') },
    })
    expect(result.reason).toBe('denied')
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(modelCalled).toBe(false)
    expect(contextReads).toEqual([])
    expect(scopeLookups).toEqual(['clerk_nathan'])
    expect(insertedDrafts).toHaveLength(0)
  })

  it('lets the same member file a note about a client in their scope', async () => {
    scopeFor = () => ['o_giant']
    const database = fakeDb({ organisations: ORGS, task_suggestions: [], team_members: [{ clerkUserId: 'clerk_nathan' }] })
    const result = await draftFromNote({
      database,
      text: 'I will send the font headers to Giant Group',
      identity: NATHAN,
      suggest: suggesterReturning([suggestion()]),
    })
    expect(result.ok).toBe(true)
    expect(contextReads).toEqual(['o_giant'])
  })

  it('refuses a null-org note without organisation access before reading context', async () => {
    scopeFor = () => []
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'remember to renew the domain before it lapses',
      identity: NATHAN,
      suggest: suggesterReturning([suggestion({ quote: 'remember to renew the domain before it lapses' })]),
    })
    expect(result.ok).toBe(false)
    expect(scopeLookups).toEqual(['clerk_studio'])
    expect(contextReads).toEqual([])
    expect(insertedDrafts).toEqual([])
  })

  it('answers a repeat of a note already on file with one line rather than an empty card list', async () => {
    insertResult = { inserted: 0, duplicates: 1, similarDropped: 0 }
    const database = fakeDb({ organisations: ORGS, task_suggestions: [] })
    const result = await draftFromNote({
      database,
      text: 'remember to renew the domain before it lapses',
      identity: NATHAN,
      suggest: suggesterReturning([suggestion({ quote: 'remember to renew the domain before it lapses' })]),
    })
    expect(result.reason).toBe('already_on_file')
    expect(result.reply).toBe(NOTE_REPLY_TEAM_ON_FILE)
  })
})

describe('studio note feature grants before context or cards', () => {
  it.each([
    ['tasks', 'send the headers to Giant Group'],
    ['requests', 'send the headers to Giant Group'],
    ['tasks', 'renew the studio domain'],
    ['requests', 'renew the studio domain'],
  ])('refuses denied %s for %s', async (feature, text) => {
    grantedFeatures.delete(feature)
    const suggest = vi.fn(suggesterReturning([suggestion()]))
    const result = await draftFromNote({ database: fakeDb({ organisations: ORGS }), text,
      identity: identity({ level: 'member', teamMemberId: 'tm_nathan' }), suggest })
    expect(result.ok).toBe(false)
    expect(result.reply).toBe(SLACK_DENIED_REPLY)
    expect(contextReads).toEqual([])
    expect(suggest).not.toHaveBeenCalled()
    expect(insertedDrafts).toEqual([])
  })

  it.each(['roleless', 'missing login', 'permission failure', 'missing studio org'])('fails closed for %s', async failure => {
    if (failure === 'roleless') activeRoles = []
    if (failure === 'permission failure') permissionFailure = true
    if (failure === 'missing studio org') vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', '')
    const database = fakeDb({ organisations: ORGS, ...(failure === 'missing login' ? { team_members: [] } : {}) })
    const suggest = vi.fn(suggesterReturning([suggestion()]))
    const result = await draftFromNote({ database, text: 'renew the studio domain', identity: identity(), suggest })
    expect(result.ok).toBe(false)
    expect(contextReads).toEqual([])
    expect(suggest).not.toHaveBeenCalled()
    expect(insertedDrafts).toEqual([])
  })

  it('allows a null-org note with both features and some organisation access', async () => {
    scopeFor = () => ['o_giant']
    const result = await draftFromNote({ database: fakeDb({ organisations: ORGS }), text: 'renew the studio domain',
      identity: identity({ level: 'member' }), suggest: suggesterReturning([suggestion()]) })
    expect(result.ok).toBe(true)
    expect(contextReads).toEqual([null])
    expect(insertedDrafts).toHaveLength(1)
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
