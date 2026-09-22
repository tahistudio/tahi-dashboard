/**
 * lib/slack/identity.ts
 *
 * Who is on the other end of a DM, and what they are allowed to ask for
 * (CN.2 section 1).
 *
 * STUB NOTE (slice S3). This file belongs to slice S1, which also adds
 * `resolveSlackIdentity(database, { teamId, userId, fetchProfile })` and the
 * `slack_identities` table behind it. S3 needs the SHAPE and the PERMISSION
 * MATRIX to build the DM handler against, and those two things are pure, so
 * they are here and S1 adds the lookup above them. If S1 landed first, this
 * file is already longer than this and nothing below needs to change.
 *
 * The matrix is deny by default on purpose. Slack is the one surface where a
 * stranger can reach the studio by typing a name into a search box, so the
 * question is never "is this person blocked" but "has this person been
 * granted the thing they are asking for".
 */

/**
 * The four levels, in the order they widen. `unknown` is not a failure state:
 * it is the correct answer for a real human in the workspace who is not on
 * the roster and not a client contact, and it has to be a level rather than a
 * null so every call site is forced to think about it.
 */
export type SlackLevel = 'founder' | 'member' | 'client' | 'unknown'

/** One row of `slack_identities`, as every handler reads it. */
export interface SlackIdentity {
  id: string
  slackTeamId: string
  slackUserId: string
  email: string | null
  level: SlackLevel
  teamMemberId: string | null
  contactId: string | null
  /** The client's org, for level `client`. Null for the studio's own people. */
  orgId: string | null
  /** The app's DM channel with this person, cached so a reply needs no round trip. */
  dmChannelId: string | null
}

/** Everything a handler may ask permission for. */
export type SlackAction =
  | 'decide_call_suggestions'
  | 'create_task'
  | 'create_request_own_org'
  | 'create_request_any_org'
  | 'read_own_work'
  | 'read_studio_numbers'

/**
 * The matrix from the contract, written as data rather than branches so a new
 * action cannot be added without saying who may do it.
 */
const ALLOWED: Record<SlackAction, readonly SlackLevel[]> = {
  decide_call_suggestions: ['founder'],
  create_task: ['founder', 'member'],
  create_request_own_org: ['client'],
  create_request_any_org: ['founder', 'member'],
  read_own_work: ['founder', 'member', 'client'],
  read_studio_numbers: ['founder'],
}

/**
 * The one sentence a denied or unrecognised person gets.
 *
 * It names nothing. Not the studio's clients, not whether the sender's email
 * was found, not whether the thing they asked about exists. A refusal that
 * explains itself is a refusal that can be probed.
 */
export const SLACK_DENIED_REPLY = 'I am not able to help with that here.'

/** Deny by default: no identity, or a level outside the action's list, is no. */
export function can(identity: SlackIdentity | null | undefined, action: SlackAction): boolean {
  if (!identity) return false
  return ALLOWED[action].includes(identity.level)
}

/** True for the studio's own people, who share one set of write paths. */
export function isStudioLevel(level: SlackLevel): boolean {
  return level === 'founder' || level === 'member'
}
