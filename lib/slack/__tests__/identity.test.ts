/**
 * lib/slack/identity.ts, the answer to "who is this Slack user, and what is
 * that person allowed to make the studio do".
 *
 * What is pinned here:
 *
 *   THE FOUR LEVELS AND HOW AN EMAIL REACHES THEM. A super_admin on the
 *   roster is a founder, any other team member is a member, a client contact
 *   is a client on their own org, and everybody else is unknown. The mapping
 *   is by email because that is the only field a Slack Connect guest and a
 *   contacts row reliably share.
 *
 *   DENY BY DEFAULT. An unknown identity can do nothing at all, and can()
 *   answers false for every action rather than throwing, so a handler that
 *   forgets a branch fails closed.
 *
 *   THE CACHE IS A CACHE. A mapping older than seven days is re-read from
 *   Slack, a fresh one is not, and a profile lookup that fails never
 *   downgrades somebody who was already mapped.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { schema } from '@/db/d1'
import {
  resolveSlackIdentity,
  can,
  DENIAL_LINE,
  SLACK_IDENTITY_TTL_MS,
  type SlackCapability,
  type SlackIdentity,
  type SlackLevel,
} from '../identity'

type Row = Record<string, unknown>
type Rows = Record<string, Row[]>

const TABLE_KEYS = new Map<unknown, string>([
  [schema.slackIdentities, 'slack_identities'],
  [schema.teamMembers, 'team_members'],
  [schema.teamMemberRoles, 'team_member_roles'],
  [schema.roles, 'roles'],
  [schema.contacts, 'contacts'],
])

function fakeDb(rows: Rows) {
  const inserted: Array<{ table: string; values: Row }> = []
  const updated: Array<{ table: string; values: Row }> = []
  const name = (table: unknown): string => TABLE_KEYS.get(table) ?? 'unknown'

  function reader(table: unknown) {
    // A join reads from the joined table's key: the role lookup selects FROM
    // team_member_roles and joins roles, so the fixture keys on the first.
    const data = rows[name(table)] ?? []
    const node: Record<string, unknown> = {}
    node.where = () => node
    node.innerJoin = () => node
    node.orderBy = () => node
    node.limit = () => node
    node.then = <T>(resolve: (value: Row[]) => T) => Promise.resolve(data).then(resolve)
    return node
  }

  const database = {
    select: () => ({ from: (table: unknown) => reader(table) }),
    insert: (table: unknown) => ({
      values: async (values: Row) => { inserted.push({ table: name(table), values }) },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async () => { updated.push({ table: name(table), values }) },
      }),
    }),
  }

  return { database: database as unknown as Parameters<typeof resolveSlackIdentity>[0], inserted, updated }
}

const NOW = '2026-09-22T09:00:00.000Z'
const TEAM = 'T_TAHI'

function identityRow(overrides: Row = {}): Row {
  return {
    id: 'si1',
    slackTeamId: TEAM,
    slackUserId: 'U_LIAM',
    email: 'business@tahi.studio',
    level: 'founder',
    teamMemberId: 'tm_liam',
    contactId: null,
    orgId: null,
    dmChannelId: 'D_LIAM',
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

let profileCalls: number

beforeEach(() => { profileCalls = 0 })

function profile(email: string | null) {
  return async () => { profileCalls += 1; return { email } }
}

describe('resolveSlackIdentity mapping', () => {
  it('maps a super_admin on the roster to founder', async () => {
    const { database, inserted } = fakeDb({
      slack_identities: [],
      team_members: [{ id: 'tm_liam', email: 'business@tahi.studio' }],
      team_member_roles: [{ name: 'super_admin' }],
    })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM,
      userId: 'U_LIAM',
      fetchProfile: profile('Business@Tahi.Studio'),
      now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('founder')
    expect(identity.teamMemberId).toBe('tm_liam')
    expect(identity.orgId).toBeNull()
    // The email is normalised, so a second Slack profile with different casing
    // resolves to the same roster row rather than a second identity.
    expect(identity.email).toBe('business@tahi.studio')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe('slack_identities')
    expect(inserted[0].values).toMatchObject({ slackTeamId: TEAM, slackUserId: 'U_LIAM', level: 'founder' })
  })

  it('maps any other team member to member', async () => {
    const { database } = fakeDb({
      slack_identities: [],
      team_members: [{ id: 'tm_nathan', email: 'nathan@tahi.studio' }],
      team_member_roles: [{ name: 'task_handler' }],
    })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_NATHAN', fetchProfile: profile('nathan@tahi.studio'), now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('member')
    expect(identity.teamMemberId).toBe('tm_nathan')
  })

  it('maps a team member with no role rows at all to member, not founder', async () => {
    const { database } = fakeDb({
      slack_identities: [],
      team_members: [{ id: 'tm_new', email: 'new@tahi.studio' }],
      team_member_roles: [],
    })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_NEW', fetchProfile: profile('new@tahi.studio'), now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('member')
  })

  it('maps a client contact to client, carrying their org', async () => {
    const { database } = fakeDb({
      slack_identities: [],
      team_members: [],
      contacts: [{ id: 'c_ngaire', orgId: 'org_giant' }],
    })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_NGAIRE', fetchProfile: profile('ngaire@giantgroup.co.nz'), now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('client')
    expect(identity.contactId).toBe('c_ngaire')
    expect(identity.orgId).toBe('org_giant')
    expect(identity.teamMemberId).toBeNull()
  })

  it('maps anybody else to unknown and still records the row, so the next DM is cheap', async () => {
    const { database, inserted } = fakeDb({ slack_identities: [], team_members: [], contacts: [] })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_STRANGER', fetchProfile: profile('someone@example.com'), now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('unknown')
    expect(inserted[0].values).toMatchObject({ level: 'unknown', email: 'someone@example.com' })
  })

  it('maps a user whose profile carries no email to unknown without touching the roster', async () => {
    const { database } = fakeDb({ slack_identities: [], team_members: [{ id: 'tm_liam', email: 'business@tahi.studio' }] })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_BOT', fetchProfile: profile(null), now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('unknown')
    expect(identity.email).toBeNull()
  })
})

describe('resolveSlackIdentity cache', () => {
  it('uses a fresh row without asking Slack again', async () => {
    const { database, inserted, updated } = fakeDb({ slack_identities: [identityRow()] })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_LIAM', fetchProfile: profile('business@tahi.studio'), now: NOW,
    })
    expect(profileCalls).toBe(0)
    expect(identity.level).toBe<SlackLevel>('founder')
    expect(inserted).toHaveLength(0)
    // A cache hit bumps last_seen_at ONLY. Writing updated_at here would mean
    // an active user's mapping never expires and a departed member keeps their
    // level forever.
    expect(updated).toHaveLength(1)
    expect(Object.keys(updated[0].values)).toEqual(['lastSeenAt'])
  })

  it('re-reads a mapping older than the seven day window', async () => {
    const stale = new Date(Date.parse(NOW) - SLACK_IDENTITY_TTL_MS - 1000).toISOString()
    const { database, updated } = fakeDb({
      slack_identities: [identityRow({ updatedAt: stale, level: 'member', teamMemberId: 'tm_liam' })],
      team_members: [{ id: 'tm_liam', email: 'business@tahi.studio' }],
      team_member_roles: [{ name: 'super_admin' }],
    })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_LIAM', fetchProfile: profile('business@tahi.studio'), now: NOW,
    })
    expect(profileCalls).toBe(1)
    expect(identity.level).toBe<SlackLevel>('founder')
    expect(updated).toHaveLength(1)
    expect(updated[0].values).toMatchObject({ level: 'founder', updatedAt: NOW })
  })

  it('keeps the cached mapping when the profile lookup fails, rather than demoting somebody', async () => {
    const stale = new Date(Date.parse(NOW) - SLACK_IDENTITY_TTL_MS - 1000).toISOString()
    const { database } = fakeDb({ slack_identities: [identityRow({ updatedAt: stale })] })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM,
      userId: 'U_LIAM',
      fetchProfile: async () => { throw new Error('ratelimited') },
      now: NOW,
    })
    expect(identity.level).toBe<SlackLevel>('founder')
    expect(identity.teamMemberId).toBe('tm_liam')
  })

  it('remembers a DM channel handed in, so the bot does not re-open one per message', async () => {
    const { database, inserted } = fakeDb({ slack_identities: [], team_members: [], contacts: [] })
    const identity = await resolveSlackIdentity(database, {
      teamId: TEAM, userId: 'U_STRANGER', fetchProfile: profile(null), dmChannelId: 'D_NEW', now: NOW,
    })
    expect(identity.dmChannelId).toBe('D_NEW')
    expect(inserted[0].values).toMatchObject({ dmChannelId: 'D_NEW' })
  })
})

describe('can', () => {
  const at = (level: SlackLevel): SlackIdentity => ({
    id: 'si', slackTeamId: TEAM, slackUserId: 'U', email: null, level,
    teamMemberId: null, contactId: null, orgId: null, dmChannelId: null,
  })

  const MATRIX: Record<SlackCapability, SlackLevel[]> = {
    decide_call_suggestions: ['founder'],
    create_task: ['founder', 'member'],
    create_request_own_org: ['client'],
    create_request_any_org: ['founder', 'member'],
    read_own_work: ['founder', 'member', 'client'],
    read_studio_numbers: ['founder'],
  }

  const LEVELS: SlackLevel[] = ['founder', 'member', 'client', 'unknown']

  it('matches the contract matrix exactly, action by action and level by level', () => {
    for (const [action, allowed] of Object.entries(MATRIX) as Array<[SlackCapability, SlackLevel[]]>) {
      for (const level of LEVELS) {
        expect({ action, level, allowed: can(at(level), action) })
          .toEqual({ action, level, allowed: allowed.includes(level) })
      }
    }
  })

  it('lets an unknown identity do nothing at all', () => {
    for (const action of Object.keys(MATRIX) as SlackCapability[]) {
      expect(can(at('unknown'), action)).toBe(false)
    }
  })

  it('has one plain refusal line that names nothing that exists', () => {
    expect(DENIAL_LINE).toMatch(/^[A-Z]/)
    expect(DENIAL_LINE.split('.').filter((part) => part.trim())).toHaveLength(1)
    expect(DENIAL_LINE).not.toMatch(/task|request|client|founder|org/i)
  })
})
