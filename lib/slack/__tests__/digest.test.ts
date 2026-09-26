/**
 * lib/slack/digest.ts, the Monday digest of suggestions still waiting.
 *
 * What is pinned here:
 *
 *   THE WINDOW. Monday 08:00 to 09:59 in Auckland, read through the tz
 *   database, so the two Sunday UTC slots land on the right side of it in
 *   both NZDT and NZST, and the NZ ISO week is the week key.
 *
 *   NOTHING WITHOUT SLACK. No token means no database access at all. A dry
 *   run is the one exception, and it only reads.
 *
 *   ONCE A WEEK. A claim row per Slack user per week, written before the
 *   post. A second run finds it; a failed post gives it back; a claim that
 *   cannot be made (no table) means no post, never a throw.
 *
 *   WHO HEARS WHAT. A founder with an active super_admin role gets the studio
 *   digest. A member gets only their own notes, only those they can still
 *   reach, and never a number about anybody else's queue. Clients, strangers
 *   and a founder whose role has ended get nothing. No quote, no dash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'

const scopes = vi.hoisted(() => new Map<string | null, string[] | null>())
const scopeFailures = vi.hoisted(() => new Set<string | null>())

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async (_database: unknown, clerkUserId: string | null) => {
    if (scopeFailures.has(clerkUserId)) throw new Error('D1_ERROR: scoping lookup failed')
    return (scopes.has(clerkUserId) ? scopes.get(clerkUserId) : []) ?? null
  },
}))

// The real Slack must never be reached from here: every run below injects
// its own postMessage and openDm, and the token is read from the env.
vi.mock('@/lib/slack/api', () => ({
  slackBotToken: () => {
    const token = process.env.SLACK_BOT_TOKEN
    return token && token.trim() ? token : null
  },
  postMessage: async () => { throw new Error('the real Slack was called') },
  openDm: async () => { throw new Error('the real Slack was called') },
  updateMessage: async () => { throw new Error('the real Slack was called') },
}))

const {
  DIGEST_ENABLED_SETTING,
  DIGEST_OPEN_INBOX_ACTION_ID,
  nzDigestSlot,
  parseDigestFlag,
  runSuggestionDigest,
} = await import('../digest')

type Database = Parameters<typeof runSuggestionDigest>[0]

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
/** Monday 28 September 2026, 08:30 in Auckland (NZDT began the day before). */
const MONDAY = new Date('2026-09-27T19:30:00Z')
const TUESDAY = new Date('2026-09-28T19:30:00Z')

function ago(ms: number, from: Date = MONDAY): string {
  return new Date(from.getTime() - ms).toISOString()
}

interface FakeSuggestion {
  id: string
  orgId: string | null
  orgName: string | null
  kind: string
  proposal: string
  status: string
  snoozeUntil: string | null
  approverType: string
  approverId: string | null
  decidedAt: string | null
  updatedAt: string
  createdAt: string
  /** Carried by the fake on purpose: the digest must never read it. */
  quote: string
}

interface DigestRow {
  id: string
  week_key: string
  slack_user_id: string
  channel_id: string | null
  ts: string | null
  summary: string | null
}

interface Store {
  identities: Array<{ id: string; slackUserId: string; level: string; teamMemberId: string | null; dmChannelId: string | null }>
  roles: Array<{ teamMemberId: string; name: string; endedAt: string | null }>
  members: Array<{ id: string; clerkUserId: string | null }>
  suggestions: FakeSuggestion[]
  settings: Array<{ key: string; value: string | null }>
  digests: DigestRow[]
  digestsMissing: boolean
  identityUpdates: Array<Record<string, unknown>>
  writes: number
}

let seq = 0

function suggestion(overrides: Partial<FakeSuggestion>): FakeSuggestion {
  seq += 1
  return {
    id: `s${seq}`,
    orgId: 'o_ver',
    orgName: 'Verandela',
    kind: 'create_task',
    proposal: JSON.stringify({ title: `Task ${seq}` }),
    status: 'pending',
    snoozeUntil: null,
    approverType: 'founders',
    approverId: null,
    decidedAt: null,
    updatedAt: ago(DAY),
    createdAt: ago(DAY),
    quote: `SECRET QUOTE ${seq}: we said this on the call`,
    ...overrides,
  }
}

function waiting(id: string, orgId: string | null, orgName: string | null, days: number, extra: Partial<FakeSuggestion> = {}): FakeSuggestion {
  return suggestion({ id, orgId, orgName, createdAt: ago(days * DAY), updatedAt: ago(days * DAY), ...extra })
}

/** The whole studio on a Monday morning: 14 waiting, and every context line. */
function busyStudio(): FakeSuggestion[] {
  const rows: FakeSuggestion[] = [
    waiting('v1', 'o_ver', 'Verandela', 12, {
      kind: 'create_request',
      proposal: JSON.stringify({ title: 'Footer LinkedIn tag', description: 'Add the tag to the footer' }),
    }),
    waiting('v2', 'o_ver', 'Verandela', 10),
    waiting('v3', 'o_ver', 'Verandela', 9),
    waiting('v4', 'o_ver', 'Verandela', 8),
    waiting('v5', 'o_ver', 'Verandela', 5),
    waiting('v6', 'o_ver', 'Verandela', 3),
    waiting('v7', 'o_ver', 'Verandela', 2),
    waiting('v8', 'o_ver', 'Verandela', 1),
    waiting('e1', 'o_ele', 'Elevate', 4),
    waiting('e2', 'o_ele', 'Elevate', 3),
    waiting('e3', 'o_ele', 'Elevate', 2),
    waiting('e4', 'o_ele', 'Elevate', 1),
    waiting('h1', null, null, 6, { proposal: JSON.stringify({ title: 'Renew the font licences' }) }),
    waiting('h2', null, null, 0),
  ]
  // Snoozed: the earliest comes back Friday 09:00 in Auckland.
  rows.push(suggestion({ status: 'snoozed', snoozeUntil: '2026-10-02T20:00:00.000Z' }))
  rows.push(suggestion({ status: 'snoozed', snoozeUntil: '2026-10-01T20:00:00.000Z' }))
  rows.push(suggestion({ status: 'snoozed', snoozeUntil: '2026-10-05T20:00:00.000Z' }))
  // Client drafts: two waiting on the client, one already confirmed.
  rows.push(suggestion({ approverType: 'contact', approverId: 'c1', kind: 'create_request' }))
  rows.push(suggestion({ approverType: 'contact', approverId: 'c2', kind: 'create_request' }))
  rows.push(suggestion({ approverType: 'contact', approverId: 'c1', kind: 'create_request', status: 'applied', decidedAt: ago(DAY) }))
  // Failed: two recent, one too old to be news.
  rows.push(suggestion({ status: 'failed', updatedAt: ago(3 * DAY), decidedAt: ago(3 * DAY) }))
  rows.push(suggestion({ status: 'failed', updatedAt: ago(5 * DAY), decidedAt: ago(5 * DAY) }))
  rows.push(suggestion({ status: 'failed', updatedAt: ago(20 * DAY), decidedAt: ago(20 * DAY) }))
  // Last week: nine approved and four rejected by the founders, and two
  // that do not count (too old, and somebody's own note).
  for (let i = 0; i < 9; i++) {
    rows.push(suggestion({ status: 'applied', decidedAt: ago((1 + (i % 6)) * DAY), updatedAt: ago((1 + (i % 6)) * DAY) }))
  }
  for (let i = 0; i < 4; i++) {
    rows.push(suggestion({ status: 'rejected', decidedAt: ago(2 * DAY), updatedAt: ago(2 * DAY) }))
  }
  rows.push(suggestion({ status: 'applied', decidedAt: ago(10 * DAY), updatedAt: ago(10 * DAY) }))
  rows.push(suggestion({ status: 'applied', approverType: 'member', approverId: 'tm_nathan', decidedAt: ago(DAY), updatedAt: ago(DAY) }))
  // Liam's own notes: one old, one sent this morning.
  rows.push(waiting('ln1', 'o_ver', 'Verandela', 2, {
    approverType: 'member', approverId: 'tm_liam', proposal: JSON.stringify({ title: 'Call Tim about the launch' }),
  }))
  rows.push(suggestion({
    id: 'ln2', approverType: 'member', approverId: 'tm_liam', createdAt: ago(2 * HOUR),
    proposal: JSON.stringify({ title: 'Send the invoice' }),
  }))
  // Nathan's own notes: one he can reach, one on a client he lost, one with
  // no client, and one too fresh to nag him about.
  rows.push(waiting('nn1', 'o_ver', 'Verandela', 3, {
    approverType: 'member', approverId: 'tm_nathan', proposal: JSON.stringify({ title: 'Fix the nav on mobile' }),
  }))
  rows.push(waiting('nn2', 'o_ele', 'Elevate', 2, {
    approverType: 'member', approverId: 'tm_nathan', proposal: JSON.stringify({ title: 'Elevate hero swap' }),
  }))
  rows.push(suggestion({
    id: 'nn3', orgId: null, orgName: null, approverType: 'member', approverId: 'tm_nathan', createdAt: ago(30 * HOUR),
    proposal: JSON.stringify({ title: 'Tidy the studio drive' }),
  }))
  rows.push(suggestion({
    id: 'nn4', approverType: 'member', approverId: 'tm_nathan', createdAt: ago(3 * HOUR),
    proposal: JSON.stringify({ title: 'Brand new thought' }),
  }))
  return rows
}

function baseStore(suggestions: FakeSuggestion[] = busyStudio()): Store {
  return {
    identities: [
      { id: 'si_liam', slackUserId: 'U_LIAM', level: 'founder', teamMemberId: 'tm_liam', dmChannelId: 'D_LIAM' },
      { id: 'si_staci', slackUserId: 'U_STACI', level: 'founder', teamMemberId: 'tm_staci', dmChannelId: null },
      { id: 'si_nathan', slackUserId: 'U_NATHAN', level: 'member', teamMemberId: 'tm_nathan', dmChannelId: 'D_NATHAN' },
      { id: 'si_old', slackUserId: 'U_OLD', level: 'founder', teamMemberId: 'tm_old', dmChannelId: 'D_OLD' },
      { id: 'si_client', slackUserId: 'U_CLIENT', level: 'client', teamMemberId: null, dmChannelId: 'D_CLIENT' },
      { id: 'si_unknown', slackUserId: 'U_UNKNOWN', level: 'unknown', teamMemberId: null, dmChannelId: 'D_UNKNOWN' },
    ],
    roles: [
      { teamMemberId: 'tm_liam', name: 'super_admin', endedAt: null },
      { teamMemberId: 'tm_staci', name: 'super_admin', endedAt: null },
      { teamMemberId: 'tm_old', name: 'super_admin', endedAt: '2026-09-01T00:00:00Z' },
    ],
    members: [
      { id: 'tm_nathan', clerkUserId: 'clerk_nathan' },
      { id: 'tm_old', clerkUserId: 'clerk_old' },
    ],
    suggestions,
    settings: [],
    digests: [],
    digestsMissing: false,
    identityUpdates: [],
    writes: 0,
  }
}

/** The raw text and bound values of a drizzle `sql` template. */
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

/**
 * A database that answers by table and ignores every WHERE, so the digest's
 * own classification is what decides which row goes in which line. The
 * slack_digests claim is simulated from the raw SQL, unique on week and user.
 */
function fakeDb(store: Store): Database {
  function rowsFor(table: unknown): unknown[] {
    if (table === schema.taskSuggestions) return store.suggestions
    if (table === schema.slackIdentities) return store.identities
    if (table === schema.teamMemberRoles) return store.roles
    if (table === schema.teamMembers) return store.members
    if (table === schema.settings) return store.settings
    return []
  }

  const database = {
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsFor(table)
        const node: Record<string, unknown> = {}
        for (const method of ['where', 'leftJoin', 'innerJoin', 'orderBy', 'limit']) node[method] = () => node
        node.then = <T>(resolve: (value: unknown[]) => T, reject?: (reason: unknown) => T) =>
          Promise.resolve(rows).then(resolve, reject)
        return node
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          store.writes++
          store.identityUpdates.push(values)
        },
      }),
    }),
    run: async (query: unknown) => {
      const { text, params } = renderSql(query)
      if (!text.includes('slack_digests')) return {}
      if (store.digestsMissing) throw new Error('no such table: slack_digests')
      store.writes++
      if (text.includes('INSERT OR IGNORE INTO slack_digests')) {
        const [id, weekKey, slackUserId] = params as string[]
        if (!store.digests.some(row => row.week_key === weekKey && row.slack_user_id === slackUserId)) {
          store.digests.push({ id, week_key: weekKey, slack_user_id: slackUserId, channel_id: null, ts: null, summary: null })
        }
      } else if (text.includes('UPDATE slack_digests')) {
        const [channel, ts, summary, id] = params as string[]
        const row = store.digests.find(candidate => candidate.id === id)
        if (row) Object.assign(row, { channel_id: channel, ts, summary })
      } else if (text.includes('DELETE FROM slack_digests')) {
        const [id] = params as string[]
        const index = store.digests.findIndex(candidate => candidate.id === id)
        if (index >= 0) store.digests.splice(index, 1)
      }
      return {}
    },
    all: async (query: unknown) => {
      const { text, params } = renderSql(query)
      if (!text.includes('FROM slack_digests')) return []
      if (store.digestsMissing) throw new Error('no such table: slack_digests')
      const [weekKey, slackUserId] = params as string[]
      return store.digests
        .filter(row => row.week_key === weekKey && row.slack_user_id === slackUserId)
        .map(row => ({ id: row.id }))
    },
  }
  return database as unknown as Database
}

const posted: Array<{ channel: string; text: string; blocks: unknown[] }> = []
const opened: string[] = []
let postFails: (channel: string) => boolean = () => false

const deps = {
  postMessage: async (input: { channel: string; text: string; blocks?: readonly unknown[] }) => {
    if (postFails(input.channel)) throw new Error('Slack chat.postMessage failed: channel_not_found')
    posted.push({ channel: input.channel, text: input.text, blocks: [...(input.blocks ?? [])] })
    return { channel: input.channel, ts: `1759000000.000${posted.length}` }
  },
  openDm: async (slackUserId: string) => {
    opened.push(slackUserId)
    return `D_${slackUserId.replace(/^U_/, '')}`
  },
}

function allText(payload: { text: string; blocks: unknown[] }): string {
  return `${payload.text}\n${JSON.stringify(payload.blocks)}`
}

function sentTo(channel: string): string {
  const message = posted.find(p => p.channel === channel)
  if (!message) throw new Error(`nothing was posted to ${channel}`)
  return allText(message)
}

beforeEach(() => {
  posted.length = 0
  opened.length = 0
  postFails = () => false
  scopes.clear()
  scopeFailures.clear()
  scopes.set('clerk_nathan', ['o_ver'])
  scopes.set('clerk_old', [])
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('nzDigestSlot', () => {
  it('reads 19:30 UTC on the last Sunday of September 2026 as Monday 08:30 NZDT, inside the window', () => {
    expect(nzDigestSlot(new Date('2026-09-27T19:30:00Z'))).toEqual({ inWindow: true, weekKey: '2026-W40', localDate: '2026-09-28' })
  })

  it('reads 20:00 UTC the same night as 09:00 NZDT, still inside and the same week', () => {
    expect(nzDigestSlot(new Date('2026-09-27T20:00:00Z'))).toEqual({ inWindow: true, weekKey: '2026-W40', localDate: '2026-09-28' })
  })

  it('reads 19:30 UTC in June as 07:30 NZST, before the window opens', () => {
    const slot = nzDigestSlot(new Date('2026-06-14T19:30:00Z'))
    expect(slot.inWindow).toBe(false)
    expect(slot.localDate).toBe('2026-06-15')
  })

  it('reads 20:00 UTC in June as 08:00 NZST, inside the window', () => {
    expect(nzDigestSlot(new Date('2026-06-14T20:00:00Z'))).toEqual({ inWindow: true, weekKey: '2026-W25', localDate: '2026-06-15' })
  })

  it('refuses a Tuesday at the same hour', () => {
    expect(nzDigestSlot(new Date('2026-09-28T19:30:00Z')).inWindow).toBe(false)
  })

  it('closes at 10:00', () => {
    expect(nzDigestSlot(new Date('2026-09-27T20:59:00Z')).inWindow).toBe(true)
    expect(nzDigestSlot(new Date('2026-09-27T21:00:00Z')).inWindow).toBe(false)
  })

  it('keeps the ISO week across a year boundary', () => {
    // Monday 4 January 2027 in Auckland is the first day of 2027-W01.
    expect(nzDigestSlot(new Date('2027-01-03T19:30:00Z')).weekKey).toBe('2027-W01')
    // Monday 29 December 2025 belongs to 2026-W01.
    expect(nzDigestSlot(new Date('2025-12-28T19:30:00Z')).weekKey).toBe('2026-W01')
  })
})

describe('parseDigestFlag', () => {
  it('reads the query switches', () => {
    expect(parseDigestFlag('1')).toBe(true)
    expect(parseDigestFlag('true')).toBe(true)
    expect(parseDigestFlag('0')).toBe(false)
    expect(parseDigestFlag(null)).toBe(false)
    expect(parseDigestFlag('maybe')).toBe(false)
  })
})

describe('without Slack', () => {
  it('returns slack_not_configured and never touches the database', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const touched: string[] = []
    const database = new Proxy({}, {
      get(_target, property) {
        touched.push(String(property))
        throw new Error(`the database was touched: ${String(property)}`)
      },
    }) as Database
    const result = await runSuggestionDigest(database, { at: MONDAY, deps })
    expect(result).toMatchObject({ ran: false, reason: 'slack_not_configured', weekKey: '2026-W40', sent: 0 })
    expect(touched).toEqual([])
    expect(posted).toHaveLength(0)
  })

  it('still builds every message on a dry run, and writes, opens and posts nothing', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const store = baseStore()
    const result = await runSuggestionDigest(fakeDb(store), { at: TUESDAY, dryRun: true, deps })

    expect(result.ran).toBe(false)
    expect(result.reason).toBe('dry_run')
    expect(result.preview?.text).toBe('Monday digest: 14 suggestions waiting')
    expect(result.payloads?.map(p => [p.slackUserId, p.audience])).toEqual([
      ['U_LIAM', 'studio'],
      ['U_STACI', 'studio'],
      ['U_NATHAN', 'personal'],
    ])
    expect(result.recipients).toBe(4)
    expect(result.nothingToSay).toBe(1)
    expect(store.writes).toBe(0)
    expect(store.digests).toHaveLength(0)
    expect(store.identityUpdates).toHaveLength(0)
    expect(opened).toHaveLength(0)
    expect(posted).toHaveLength(0)
  })

  it('previews the studio digest as a founder with no notes of their own would read it', async () => {
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, dryRun: true, deps })
    const preview = JSON.stringify(result.preview?.blocks)
    expect(preview).toContain('14 suggestions waiting')
    expect(preview).not.toContain('Your notes waiting')
  })
})

describe('the switches', () => {
  it('stays quiet when the kill switch says false', async () => {
    const store = baseStore()
    store.settings.push({ key: DIGEST_ENABLED_SETTING, value: 'false' })
    const result = await runSuggestionDigest(fakeDb(store), { at: MONDAY, deps })
    expect(result).toMatchObject({ ran: false, reason: 'disabled', sent: 0 })
    expect(posted).toHaveLength(0)
  })

  it('reads any other value as on', async () => {
    const store = baseStore()
    store.settings.push({ key: DIGEST_ENABLED_SETTING, value: 'true' })
    const result = await runSuggestionDigest(fakeDb(store), { at: MONDAY, deps })
    expect(result.sent).toBe(3)
  })

  it('does nothing outside the Monday window', async () => {
    const store = baseStore()
    const result = await runSuggestionDigest(fakeDb(store), { at: TUESDAY, deps })
    expect(result).toMatchObject({ ran: false, reason: 'outside_window', sent: 0 })
    expect(store.digests).toHaveLength(0)
    expect(posted).toHaveLength(0)
  })

  it('sends outside the window when forced', async () => {
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: TUESDAY, force: true, deps })
    expect(result).toMatchObject({ ran: true, sent: 3, nothingToSay: 1, failed: 0, alreadySent: 0, recipients: 4 })
    expect(result.reason).toBeUndefined()
  })
})

describe('the weekly claim', () => {
  it('sends once a week: a second run finds every claim and sends nothing', async () => {
    const store = baseStore()
    const database = fakeDb(store)
    const first = await runSuggestionDigest(database, { at: MONDAY, deps })
    expect(first.sent).toBe(3)
    expect(store.digests.map(row => row.slack_user_id).sort()).toEqual(['U_LIAM', 'U_NATHAN', 'U_STACI'])
    expect(store.digests.every(row => row.week_key === '2026-W40' && row.ts && row.channel_id)).toBe(true)
    expect(JSON.parse(store.digests.find(row => row.slack_user_id === 'U_LIAM')?.summary ?? '{}')).toMatchObject({ audience: 'studio', waiting: 14 })

    const second = await runSuggestionDigest(database, { at: new Date('2026-09-27T20:00:00Z'), force: true, deps })
    expect(second).toMatchObject({ sent: 0, alreadySent: 3, nothingToSay: 1 })
    expect(posted).toHaveLength(3)
  })

  it('gives the week back when a post fails, so the next slot retries', async () => {
    const store = baseStore()
    const database = fakeDb(store)
    postFails = channel => channel === 'D_LIAM'
    const first = await runSuggestionDigest(database, { at: MONDAY, deps })
    expect(first).toMatchObject({ sent: 2, failed: 1 })
    expect(store.digests.some(row => row.slack_user_id === 'U_LIAM')).toBe(false)

    postFails = () => false
    const retry = await runSuggestionDigest(database, { at: new Date('2026-09-27T20:00:00Z'), deps })
    expect(retry).toMatchObject({ sent: 1, alreadySent: 2, failed: 0 })
    expect(posted.filter(p => p.channel === 'D_LIAM')).toHaveLength(1)
  })

  it('sends nothing, and does not throw, when the claim table is not there', async () => {
    const store = baseStore()
    store.digestsMissing = true
    const result = await runSuggestionDigest(fakeDb(store), { at: MONDAY, deps })
    expect(result).toMatchObject({ ran: true, sent: 0, failed: 3 })
    expect(posted).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })
})

describe('the studio digest', () => {
  it('counts what is waiting, by client, with the oldest age where it has sat a week', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const liam = sentTo('D_LIAM')
    expect(liam).toContain('*Monday digest* · 14 suggestions waiting')
    expect(liam).toContain('Verandela 8 (oldest 12 days) · Elevate 4 · Studio 2')
  })

  it('lists the five oldest waiting, each with a Review link into the inbox', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const message = posted.find(p => p.channel === 'D_LIAM')
    const sections = (message?.blocks ?? []) as Array<{ type: string; text?: { text: string } }>
    const list = sections.find(block => block.type === 'section' && block.text?.text.startsWith('• '))?.text?.text ?? ''
    const lines = list.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('• New request: Footer LinkedIn tag · Verandela · 12 days · <https://portal.tahi.studio/tasks?view=suggestions&amp;focus=v1|Review>')
    expect(lines.map(line => line.match(/focus=(\w+)\|/)?.[1])).toEqual(['v1', 'v2', 'v3', 'v4', 'h1'])
    expect(lines[4]).toContain('Renew the font licences · Studio · 6 days')
  })

  it('carries each context line: snoozed, client drafts, failed and last week', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const liam = sentTo('D_LIAM')
    expect(liam).toContain('3 snoozed, next back Fri 09:00')
    expect(liam).toContain('2 client drafts not confirmed by the client yet')
    expect(liam).toContain('2 approvals did not apply in the last 14 days')
    expect(liam).toContain('Last week: 9 approved, 4 rejected')
  })

  it('names only a snooze still ahead as next back, and no time once every snooze has ended', async () => {
    // 18:00 UTC Sunday is 07:00 Monday in Auckland, before this run at 08:30.
    const ended = '2026-09-27T18:00:00.000Z'
    await runSuggestionDigest(fakeDb(baseStore([
      waiting('w1', 'o_ver', 'Verandela', 2),
      suggestion({ status: 'snoozed', snoozeUntil: ended }),
      suggestion({ status: 'snoozed', snoozeUntil: '2026-10-01T20:00:00.000Z' }),
    ])), { at: MONDAY, deps })
    expect(sentTo('D_LIAM')).toContain('2 snoozed, next back Fri 09:00')

    posted.length = 0
    await runSuggestionDigest(fakeDb(baseStore([
      waiting('w1', 'o_ver', 'Verandela', 2),
      suggestion({ status: 'snoozed', snoozeUntil: ended }),
    ])), { at: MONDAY, deps })
    const liam = sentTo('D_LIAM')
    expect(liam).toContain('1 snoozed')
    expect(liam).not.toContain('next back')
  })

  it('adds the founder own notes, and only to that founder', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const liam = sentTo('D_LIAM')
    expect(liam).toContain('Your notes waiting: 2')
    expect(liam).toContain('Call Tim about the launch')
    expect(liam).toContain('Send the invoice')
    expect(sentTo('D_STACI')).not.toContain('Your notes waiting')
    expect(sentTo('D_STACI')).not.toContain('Call Tim about the launch')
  })

  it('offers one button, a link into the inbox, and nothing to approve', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const message = posted.find(p => p.channel === 'D_LIAM')
    const actions = (message?.blocks ?? []).filter(block => (block as { type: string }).type === 'actions') as Array<{
      elements: Array<{ action_id: string; url?: string; text: { text: string } }>
    }>
    expect(actions).toHaveLength(1)
    expect(actions[0].elements).toHaveLength(1)
    expect(actions[0].elements[0]).toMatchObject({
      action_id: DIGEST_OPEN_INBOX_ACTION_ID,
      url: 'https://portal.tahi.studio/tasks?view=suggestions',
      text: { text: 'Open the inbox' },
    })
    expect(JSON.stringify(message?.blocks)).not.toContain('sugg:')
  })

  it('says nothing when nothing is waiting, no own notes are waiting and nothing failed', async () => {
    const quiet = [
      suggestion({ status: 'snoozed', snoozeUntil: '2026-10-01T20:00:00.000Z' }),
      suggestion({ approverType: 'contact', approverId: 'c1', kind: 'create_request' }),
      suggestion({ status: 'applied', decidedAt: ago(DAY), updatedAt: ago(DAY) }),
    ]
    const result = await runSuggestionDigest(fakeDb(baseStore(quiet)), { at: MONDAY, deps })
    expect(result).toMatchObject({ ran: true, sent: 0, nothingToSay: 4, recipients: 4 })
    expect(posted).toHaveLength(0)

    const dry = await runSuggestionDigest(fakeDb(baseStore(quiet)), { at: MONDAY, dryRun: true, deps })
    expect(dry.preview).toBeNull()
    expect(dry.payloads).toEqual([])
  })

  it('still speaks up for a failed approval when nothing else is waiting', async () => {
    const result = await runSuggestionDigest(
      fakeDb(baseStore([suggestion({ status: 'failed', updatedAt: ago(DAY), decidedAt: ago(DAY) })])),
      { at: MONDAY, deps },
    )
    expect(result.sent).toBe(2)
    expect(sentTo('D_LIAM')).toContain('No call suggestions waiting')
    expect(sentTo('D_LIAM')).toContain('1 approval did not apply in the last 14 days')
  })
})

describe('who hears what', () => {
  it('gives a member only their own notes, and never a count of anybody else', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const nathan = sentTo('D_NATHAN')
    expect(nathan).toContain('Your notes waiting: 2')
    expect(nathan).toContain('Fix the nav on mobile')
    expect(nathan).toContain('Tidy the studio drive')
    expect(nathan).not.toContain('suggestions waiting')
    expect(nathan).not.toContain('Verandela 8')
    expect(nathan).not.toContain('Footer LinkedIn tag')
    expect(nathan).not.toContain('snoozed')
    expect(nathan).not.toContain('Last week')
    expect(nathan).not.toContain('client drafts')
  })

  it('leaves out a member note on a client they can no longer reach, and one too fresh to nag about', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    const nathan = sentTo('D_NATHAN')
    expect(nathan).not.toContain('Elevate hero swap')
    expect(nathan).not.toContain('Brand new thought')
  })

  it('leaves out a studio note too when the member can reach no client at all', async () => {
    scopes.set('clerk_nathan', [])
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    expect(result.sent).toBe(2)
    expect(posted.some(p => p.channel === 'D_NATHAN')).toBe(false)
  })

  it('reads a member whose scoping lookup throws as reaching nothing, and still sends the founders theirs', async () => {
    scopeFailures.add('clerk_nathan')
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    expect(result).toMatchObject({ ran: true, sent: 2, failed: 0 })
    expect(posted.map(p => p.channel).sort()).toEqual(['D_LIAM', 'D_STACI'])
  })

  it('gives a founder whose super_admin role has ended nothing', async () => {
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    expect(posted.some(p => p.channel === 'D_OLD')).toBe(false)
    expect(result.nothingToSay).toBe(1)

    const dry = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, dryRun: true, deps })
    expect(dry.payloads?.some(p => p.slackUserId === 'U_OLD')).toBe(false)
  })

  it('gives clients and strangers nothing, and does not count them', async () => {
    const result = await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    expect(posted.some(p => p.channel === 'D_CLIENT' || p.channel === 'D_UNKNOWN')).toBe(false)
    expect(opened).not.toContain('U_CLIENT')
    expect(opened).not.toContain('U_UNKNOWN')
    expect(result.recipients).toBe(4)
  })

  it('never carries a quote or an em or en dash', async () => {
    const store = baseStore()
    const dry = await runSuggestionDigest(fakeDb(store), { at: MONDAY, dryRun: true, deps })
    await runSuggestionDigest(fakeDb(store), { at: MONDAY, deps })
    const everything = [
      JSON.stringify(dry.preview),
      JSON.stringify(dry.payloads),
      ...posted.map(allText),
    ].join('\n')
    expect(everything).not.toContain('SECRET QUOTE')
    expect(everything).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the DM channel', () => {
  it('opens a DM for a founder with none cached and stores it back on the identity', async () => {
    const store = baseStore()
    await runSuggestionDigest(fakeDb(store), { at: MONDAY, deps })
    expect(opened).toEqual(['U_STACI'])
    expect(posted.some(p => p.channel === 'D_STACI')).toBe(true)
    expect(store.identityUpdates).toEqual([{ dmChannelId: 'D_STACI' }])
  })

  it('uses the cached channel without opening anything', async () => {
    await runSuggestionDigest(fakeDb(baseStore()), { at: MONDAY, deps })
    expect(opened).not.toContain('U_LIAM')
    expect(opened).not.toContain('U_NATHAN')
  })
})
