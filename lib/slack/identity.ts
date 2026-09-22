/**
 * lib/slack/identity.ts
 *
 * Who a Slack user is, and what that person is allowed to make the studio do.
 *
 * Slack hands a webhook a workspace id and a user id and nothing else, so
 * EMAIL is the join: it is the one field a Slack profile, a team_members row
 * and a contacts row all carry. From the email come four levels:
 *
 *   founder  a team member holding the super_admin role (Liam and Staci)
 *   member   any other team member on the roster
 *   client   a contacts row, carried with its org
 *   unknown  everybody else, including a profile with no readable email
 *
 * DENY BY DEFAULT. `unknown` appears in no capability list, so can() answers
 * false for every action rather than throwing, and a handler that forgets a
 * branch fails closed. A denied action answers with DENIAL_LINE: one plain
 * sentence that never confirms whether the thing asked about exists.
 *
 * The mapping costs a users.info call, so it is cached in slack_identities
 * and re-resolved after seven days. Two writes are deliberately different:
 * a cache HIT bumps last_seen_at only, and a RESOLVE writes updated_at. If a
 * hit touched updated_at an active user's level would never expire, and a
 * departed team member would keep their access as long as they kept talking.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type SlackLevel = 'founder' | 'member' | 'client' | 'unknown'

/** Seven days, per the contract. */
export const SLACK_IDENTITY_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The one refusal. It names no task, no client and no request, because the
 * answer to "can I see request 226" must not differ between a request that
 * exists and one that does not.
 */
export const DENIAL_LINE = 'Sorry, I cannot help with that here.'

/**
 * The same sentence, under the two names the sibling modules were written
 * against. One constant, two aliases: a second string would be a second
 * refusal to keep in step, and the whole point of the line is that every
 * refusal reads identically whatever door it came through.
 */
export const SLACK_DENIED_LINE = DENIAL_LINE
export const SLACK_DENIED_REPLY = DENIAL_LINE

export interface SlackIdentity {
  id: string
  slackTeamId: string
  slackUserId: string
  email: string | null
  level: SlackLevel
  teamMemberId: string | null
  contactId: string | null
  /** The client's org, for level 'client'. */
  orgId: string | null
  dmChannelId: string | null
}

/**
 * Every action the bot can be asked to take, and who may ask.
 *
 * Deciding a call's suggestions is founders only because that is the gate
 * CN.1 built: a suggestion is a proposal about somebody's client work and
 * approving it is the moment it becomes real. Creating a request for your own
 * org is the client's one verb. Reading the studio's numbers is the founders'.
 */
export type SlackCapability =
  | 'decide_call_suggestions'
  | 'create_task'
  | 'create_request_own_org'
  | 'create_request_any_org'
  | 'read_own_work'
  | 'read_studio_numbers'

const CAPABILITIES: Record<SlackCapability, readonly SlackLevel[]> = {
  decide_call_suggestions: ['founder'],
  create_task: ['founder', 'member'],
  create_request_own_org: ['client'],
  create_request_any_org: ['founder', 'member'],
  read_own_work: ['founder', 'member', 'client'],
  read_studio_numbers: ['founder'],
}

/**
 * True only when this level is named. Unknown is named nowhere, and neither is
 * a Slack user the app has never resolved, so a null identity is refused here
 * rather than by a null check every caller has to remember.
 */
export function can(
  identity: Pick<SlackIdentity, 'level'> | null | undefined,
  action: SlackCapability,
): boolean {
  if (!identity) return false
  return CAPABILITIES[action]?.includes(identity.level) ?? false
}

/**
 * Somebody on the Tahi roster, founder or not.
 *
 * The studio half of the app (a note becoming a task, the whole of /tasks)
 * opens for these two levels and nobody else. Written as its own predicate
 * because "not a client and not a stranger" is a sentence three modules need
 * and none of them should spell out.
 */
export function isStudioLevel(level: SlackLevel): boolean {
  return level === 'founder' || level === 'member'
}

export interface SlackProfileLookup {
  email: string | null
}

export interface ResolveIdentityInput {
  teamId: string
  userId: string
  /** Usually `() => usersInfo(userId)`. Injected so tests never hit Slack. */
  fetchProfile?: () => Promise<SlackProfileLookup | null>
  /** The DM channel this message arrived on, cached for the reply. */
  dmChannelId?: string | null
  /** ISO instant; injected in tests. */
  now?: string
}

interface IdentityRow {
  id: string
  slackTeamId: string
  slackUserId: string
  email: string | null
  level: string
  teamMemberId: string | null
  contactId: string | null
  orgId: string | null
  dmChannelId: string | null
  updatedAt: string | null
}

interface Mapping {
  level: SlackLevel
  teamMemberId: string | null
  contactId: string | null
  orgId: string | null
}

const UNMAPPED: Mapping = { level: 'unknown', teamMemberId: null, contactId: null, orgId: null }

function asLevel(value: string | null | undefined): SlackLevel {
  return value === 'founder' || value === 'member' || value === 'client' ? value : 'unknown'
}

function toIdentity(row: IdentityRow, dmChannelId: string | null): SlackIdentity {
  return {
    id: row.id,
    slackTeamId: row.slackTeamId,
    slackUserId: row.slackUserId,
    email: row.email ?? null,
    level: asLevel(row.level),
    teamMemberId: row.teamMemberId ?? null,
    contactId: row.contactId ?? null,
    orgId: row.orgId ?? null,
    dmChannelId: dmChannelId ?? row.dmChannelId ?? null,
  }
}

/** Every column an identity is read from, in one place, so the three readers
 *  below cannot drift into selecting different halves of the same row. */
const IDENTITY_COLUMNS = {
  id: schema.slackIdentities.id,
  slackTeamId: schema.slackIdentities.slackTeamId,
  slackUserId: schema.slackIdentities.slackUserId,
  email: schema.slackIdentities.email,
  level: schema.slackIdentities.level,
  teamMemberId: schema.slackIdentities.teamMemberId,
  contactId: schema.slackIdentities.contactId,
  orgId: schema.slackIdentities.orgId,
  dmChannelId: schema.slackIdentities.dmChannelId,
  updatedAt: schema.slackIdentities.updatedAt,
} as const

function isFresh(updatedAt: string | null, nowMs: number): boolean {
  if (!updatedAt) return false
  const at = Date.parse(updatedAt)
  if (Number.isNaN(at)) return false
  return nowMs - at < SLACK_IDENTITY_TTL_MS
}

/**
 * Email to level.
 *
 * The roster is checked before contacts, because a founder who is also listed
 * as a contact somewhere must not be demoted to that org's client. The
 * super_admin check counts ACTIVE role assignments only (endedAt is null),
 * mirroring lib/permissions.ts: a revoked founder role has to stop granting
 * approval rights the moment it is revoked, not seven days later.
 */
async function mapEmail(database: Drizzle, email: string): Promise<Mapping> {
  const normalised = email.trim().toLowerCase()
  if (!normalised) return UNMAPPED

  const [member] = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(sql`lower(${schema.teamMembers.email}) = ${normalised}`)
    .limit(1)

  if (member) {
    const roleRows = await database
      .select({ name: schema.roles.name })
      .from(schema.teamMemberRoles)
      .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
      .where(and(
        eq(schema.teamMemberRoles.teamMemberId, member.id),
        isNull(schema.teamMemberRoles.endedAt),
      ))
    const isFounder = roleRows.some((role) => role.name === 'super_admin')
    return { level: isFounder ? 'founder' : 'member', teamMemberId: member.id, contactId: null, orgId: null }
  }

  const [contact] = await database
    .select({ id: schema.contacts.id, orgId: schema.contacts.orgId })
    .from(schema.contacts)
    .where(sql`lower(${schema.contacts.email}) = ${normalised}`)
    .limit(1)

  if (contact) {
    return { level: 'client', teamMemberId: null, contactId: contact.id, orgId: contact.orgId ?? null }
  }

  return UNMAPPED
}

/**
 * Resolve the Slack user behind a delivery, reading the cache when it is
 * fresh and Slack when it is not.
 *
 * A profile lookup that fails never demotes somebody who was already mapped:
 * a rate-limited users.info is a Slack problem, and answering it by treating
 * a founder as a stranger would be the worse failure.
 */
export async function resolveSlackIdentity(
  database: Drizzle,
  input: ResolveIdentityInput,
): Promise<SlackIdentity> {
  const now = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const dmChannelId = input.dmChannelId ?? null

  const [existing] = await database
    .select(IDENTITY_COLUMNS)
    .from(schema.slackIdentities)
    .where(and(
      eq(schema.slackIdentities.slackTeamId, input.teamId),
      eq(schema.slackIdentities.slackUserId, input.userId),
    ))
    .limit(1) as IdentityRow[]

  if (existing && isFresh(existing.updatedAt, nowMs)) {
    // last_seen_at ONLY. See the file header for why updated_at is untouched.
    await database
      .update(schema.slackIdentities)
      .set({ lastSeenAt: now })
      .where(eq(schema.slackIdentities.id, existing.id))
    return toIdentity(existing, dmChannelId)
  }

  let email: string | null = null
  try {
    const profile = input.fetchProfile ? await input.fetchProfile() : null
    email = profile?.email?.trim().toLowerCase() || null
  } catch {
    email = null
  }

  if (!email && existing) {
    // Slack would not tell us. Keep what we knew rather than demoting anyone.
    return toIdentity(existing, dmChannelId)
  }

  const mapping = email ? await mapEmail(database, email) : UNMAPPED

  if (existing) {
    await database
      .update(schema.slackIdentities)
      .set({
        email,
        level: mapping.level,
        teamMemberId: mapping.teamMemberId,
        contactId: mapping.contactId,
        orgId: mapping.orgId,
        ...(dmChannelId ? { dmChannelId } : {}),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(schema.slackIdentities.id, existing.id))
    return {
      id: existing.id,
      slackTeamId: input.teamId,
      slackUserId: input.userId,
      email,
      level: mapping.level,
      teamMemberId: mapping.teamMemberId,
      contactId: mapping.contactId,
      orgId: mapping.orgId,
      dmChannelId: dmChannelId ?? existing.dmChannelId ?? null,
    }
  }

  const id = crypto.randomUUID()
  await database.insert(schema.slackIdentities).values({
    id,
    slackTeamId: input.teamId,
    slackUserId: input.userId,
    email,
    level: mapping.level,
    teamMemberId: mapping.teamMemberId,
    contactId: mapping.contactId,
    orgId: mapping.orgId,
    dmChannelId,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id,
    slackTeamId: input.teamId,
    slackUserId: input.userId,
    email,
    level: mapping.level,
    teamMemberId: mapping.teamMemberId,
    contactId: mapping.contactId,
    orgId: mapping.orgId,
    dmChannelId,
  }
}

/**
 * The cached identity for a Slack user, or null.
 *
 * The CACHE ONLY. resolveSlackIdentity above is the one that may spend a
 * users.info call and write a row; this is what a handler in the middle of an
 * interaction wants, because a button press already carries the person's
 * whole authorisation and a Slack API call on the way to honouring it is
 * three seconds it does not have.
 *
 * Any read failure answers null, which the capability check then refuses. A
 * database that cannot tell us who pressed the button is not a reason to act
 * as if anybody did.
 */
export async function findSlackIdentity(
  database: Drizzle,
  input: { teamId: string; userId: string },
): Promise<SlackIdentity | null> {
  if (!input.teamId || !input.userId) return null
  try {
    const [row] = await database
      .select(IDENTITY_COLUMNS)
      .from(schema.slackIdentities)
      .where(and(
        eq(schema.slackIdentities.slackTeamId, input.teamId),
        eq(schema.slackIdentities.slackUserId, input.userId),
      ))
      .limit(1) as IdentityRow[]
    return row ? toIdentity(row, null) : null
  } catch {
    return null
  }
}

/**
 * Every founder the app has ever spoken to, which is where a call's
 * suggestions go (contract section 3).
 *
 * Read off the cache rather than off team_members, because a founder with no
 * slack_identities row has never opened the app and has no DM channel to post
 * into. An empty list is a legitimate answer on a fresh install and the
 * caller treats it as "nobody to tell" rather than as a failure.
 */
export async function listFounderIdentities(database: Drizzle): Promise<SlackIdentity[]> {
  try {
    const rows = await database
      .select(IDENTITY_COLUMNS)
      .from(schema.slackIdentities)
      .where(eq(schema.slackIdentities.level, 'founder')) as IdentityRow[]
    return (rows ?? []).map(row => toIdentity(row, null))
  } catch {
    return []
  }
}
