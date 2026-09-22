/**
 * S2 stub, S1 replaces.
 *
 * Who a Slack user is to the studio, and what that lets them do (CN.2
 * contract section 1). Slice S1 owns the real module: migration 0110's
 * slack_identities table, resolveSlackIdentity with the users.info lookup and
 * the seven-day refresh, and the full can() matrix. S2 needs two of those
 * things to build against: the identity shape, and the two reads the DM
 * approvals path makes (every founder to post to, and one Slack user to
 * attribute a button click to). The lead keeps S1's version at merge.
 *
 * Raw SQL rather than a Drizzle table on purpose: migration 0110 and the
 * db/schema.ts entry both belong to S1, and a second declaration of the same
 * table would be a merge conflict for nothing.
 */

import { sql } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type SlackIdentityLevel = 'founder' | 'member' | 'client' | 'unknown'

/** The actions the bot gates on, contract section 1. */
export type SlackAction =
  | 'decide_call_suggestions'
  | 'create_task'
  | 'create_request_own_org'
  | 'create_request_any_org'
  | 'read_own_work'
  | 'read_studio_numbers'

export interface SlackIdentity {
  id: string
  slackTeamId: string
  slackUserId: string
  email: string | null
  level: SlackIdentityLevel
  teamMemberId: string | null
  contactId: string | null
  orgId: string | null
  dmChannelId: string | null
}

const ALLOWED: Record<SlackAction, readonly SlackIdentityLevel[]> = {
  decide_call_suggestions: ['founder'],
  create_task: ['founder', 'member'],
  create_request_own_org: ['client'],
  create_request_any_org: ['founder', 'member'],
  read_own_work: ['founder', 'member', 'client'],
  read_studio_numbers: ['founder'],
}

/** Deny by default: an unknown Slack user can do nothing at all, and a level
 *  the matrix has never heard of is unknown. */
export function can(identity: Pick<SlackIdentity, 'level'> | null, action: SlackAction): boolean {
  if (!identity) return false
  return ALLOWED[action]?.includes(identity.level) ?? false
}

/** The one sentence a denied action answers with. Says nothing about what
 *  exists, because the person asking is not allowed to know (section 1). */
export const SLACK_DENIED_LINE = 'Sorry, you cannot do that from here.'

interface IdentityRow {
  id: string
  slack_team_id: string
  slack_user_id: string
  email: string | null
  level: string
  team_member_id: string | null
  contact_id: string | null
  org_id: string | null
  dm_channel_id: string | null
}

function toIdentity(row: IdentityRow): SlackIdentity {
  const level: SlackIdentityLevel =
    row.level === 'founder' || row.level === 'member' || row.level === 'client' ? row.level : 'unknown'
  return {
    id: row.id,
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    email: row.email,
    level,
    teamMemberId: row.team_member_id,
    contactId: row.contact_id,
    orgId: row.org_id,
    dmChannelId: row.dm_channel_id,
  }
}

/**
 * Every founder the app knows about, which is who a call's suggestions are
 * posted to. Empty when the table is not there yet (S1 has not merged, or the
 * migration has not run), so the sweep posts nothing rather than throwing:
 * "Slack is not set up" must never fail the sweep (contract section 3).
 */
export async function listFounderIdentities(drizzle: Drizzle): Promise<SlackIdentity[]> {
  try {
    const rows = await drizzle.all<IdentityRow>(sql`
      SELECT id, slack_team_id, slack_user_id, email, level, team_member_id, contact_id, org_id, dm_channel_id
      FROM slack_identities WHERE level = 'founder'
    `)
    return (rows ?? []).map(toIdentity)
  } catch {
    return []
  }
}

/** One Slack user, looked up by the pair Slack sends on every payload. Null
 *  when the app has never seen them; S1's resolveSlackIdentity is the version
 *  that goes and asks users.info instead. */
export async function findSlackIdentity(
  drizzle: Drizzle,
  where: { teamId: string; userId: string },
): Promise<SlackIdentity | null> {
  try {
    const rows = await drizzle.all<IdentityRow>(sql`
      SELECT id, slack_team_id, slack_user_id, email, level, team_member_id, contact_id, org_id, dm_channel_id
      FROM slack_identities
      WHERE slack_team_id = ${where.teamId} AND slack_user_id = ${where.userId}
      LIMIT 1
    `)
    const row = (rows ?? [])[0]
    return row ? toIdentity(row) : null
  } catch {
    return null
  }
}
