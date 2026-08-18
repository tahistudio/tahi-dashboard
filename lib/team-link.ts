/**
 * lib/team-link.ts - decide whether a signed-in Tahi user should be linked to
 * an existing team_members row.
 *
 * WHY THIS EXISTS
 * `teamMembers.clerkUserId` is the join between a Clerk login and everything
 * the dashboard knows about a person: role resolution (lib/permissions.ts),
 * data scoping (lib/access-scoping.ts), notification delivery
 * (lib/notifications.ts), /api/admin/profile, and timers. Until now the only
 * writer of that column was a hand-crafted PUT, so a new hire signed in and
 * resolved to NO row at all. This module supplies the missing link step: on the
 * hire's first dashboard load we match their VERIFIED primary email to a row
 * that is waiting for them and claim it.
 *
 * HARD RULES (the reason this is a separate, dependency-free module):
 *   - Never creates a team_members row. A Clerk login can only ever CLAIM a row
 *     an admin already created. No self-service onboarding into the roster.
 *   - Verified email only, mirroring app/api/portal/accept-invite/route.ts. An
 *     unverified address can be attacker-controlled, so it can never claim a row.
 *   - Never overwrites a non-null clerkUserId. An already-claimed row is left
 *     exactly as it is.
 *   - Two rows sharing an email links NEITHER. Guessing could hand the wrong
 *     scope to the wrong person; the caller is expected to leave a trail instead.
 *   - Lazy: the Clerk identity read and the email query only happen on the miss
 *     path, so an already-linked user pays one indexed lookup and nothing else.
 *
 * The module takes its I/O through `TeamLinkDeps` so the decision order can be
 * unit-tested without D1 or Clerk (see lib/__tests__/team-link.test.ts), and so
 * this file stays importable from a plain Node test environment.
 */

export type TeamLinkOutcome =
  /** Caller is not in the Tahi org. Nothing was read. */
  | 'not_team_org'
  /** No usable Clerk user id (signed out, or the MCP service identity). */
  | 'no_user'
  /** A row already points at this Clerk user. No further work was done. */
  | 'already_linked'
  /** No verified primary email on the Clerk account. */
  | 'email_unverified'
  /** No roster row carries this email. A row is never created. */
  | 'no_match'
  /** More than one roster row carries this email. Nothing was linked. */
  | 'ambiguous'
  /** The single match is already claimed by a different Clerk user. */
  | 'claimed'
  /** The row was claimed by this sign-in. */
  | 'linked'
  /** A concurrent request claimed the row first. Benign. */
  | 'lost_race'

export interface TeamLinkCandidate {
  id: string
  email: string
  clerkUserId: string | null
}

export interface TeamLinkResult {
  outcome: TeamLinkOutcome
  /** The row involved, when exactly one was in play. */
  teamMemberId: string | null
  /** Lowercased email considered. Null when resolution stopped before that. */
  email: string | null
  /** Every row id that matched the email. Only interesting when ambiguous. */
  matchedIds: string[]
}

export interface TeamLinkDeps {
  /** Row id already pointing at this Clerk user, else null. */
  findLinkedMemberId: (clerkUserId: string) => Promise<string | null>
  /** The caller's primary email plus whether Clerk has verified it. */
  loadVerifiedEmail: () => Promise<{ email: string | null; verified: boolean }>
  /** Case-insensitive roster lookup. Receives an already-lowercased email. */
  findMembersByEmail: (emailLower: string) => Promise<TeamLinkCandidate[]>
  /**
   * Conditional claim. MUST be a compare-and-set on clerkUserId IS NULL so two
   * concurrent sign-ins cannot both win. Returns true only if this call wrote.
   */
  linkMember: (teamMemberId: string, clerkUserId: string) => Promise<boolean>
  /** Optional sink for outcomes worth an operator trail. */
  recordOutcome?: (result: TeamLinkResult) => Promise<void>
}

export interface TeamLinkInput {
  userId: string | null
  orgId: string | null
  tahiOrgId: string | null | undefined
}

/** The MCP service token identity. It has no human inbox, so it never links. */
const SERVICE_USER_ID = 'api-service'

/** Outcomes an operator needs to see. The rest are normal steady state. */
const TRAILED: ReadonlySet<TeamLinkOutcome> = new Set<TeamLinkOutcome>([
  'linked', 'ambiguous', 'claimed',
])

function result(
  outcome: TeamLinkOutcome,
  teamMemberId: string | null = null,
  email: string | null = null,
  matchedIds: string[] = [],
): TeamLinkResult {
  return { outcome, teamMemberId, email, matchedIds }
}

/** Trim and lowercase an email for comparison. Returns null when unusable. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/** Verdict over the rows matching the caller's email. 'link' carries its row. */
export type CandidateDecision =
  | { outcome: 'link'; teamMemberId: string }
  | { outcome: 'claimed'; teamMemberId: string }
  | { outcome: 'already_linked'; teamMemberId: string }
  | { outcome: 'no_match'; teamMemberId: null }
  | { outcome: 'ambiguous'; teamMemberId: null }

/**
 * Pure decision over the rows that matched the caller's email. Split out from
 * `resolveTeamLink` so the "which row, if any" rule can be read and tested on
 * its own.
 */
export function decideCandidate(
  candidates: readonly TeamLinkCandidate[],
  clerkUserId: string,
): CandidateDecision {
  if (candidates.length === 0) return { outcome: 'no_match', teamMemberId: null }
  if (candidates.length > 1) return { outcome: 'ambiguous', teamMemberId: null }

  const [only] = candidates
  if (only.clerkUserId === clerkUserId) return { outcome: 'already_linked', teamMemberId: only.id }
  if (only.clerkUserId !== null && only.clerkUserId !== '') {
    return { outcome: 'claimed', teamMemberId: only.id }
  }
  return { outcome: 'link', teamMemberId: only.id }
}

/**
 * Resolve (and, when unambiguous, perform) the Clerk-user to team-member link.
 * Idempotent: a second call for an already-linked user short-circuits at the
 * first lookup and touches nothing.
 */
export async function resolveTeamLink(
  deps: TeamLinkDeps,
  input: TeamLinkInput,
): Promise<TeamLinkResult> {
  const { userId, orgId, tahiOrgId } = input

  if (!tahiOrgId || orgId !== tahiOrgId) return result('not_team_org')
  if (!userId || userId === SERVICE_USER_ID) return result('no_user')

  // Miss check. On a hit we stop here, so an already-linked user never pays for
  // the Clerk round trip or the email query.
  const linkedId = await deps.findLinkedMemberId(userId)
  if (linkedId) return result('already_linked', linkedId)

  const identity = await deps.loadVerifiedEmail()
  const email = identity.verified ? normaliseEmail(identity.email) : null
  if (!email) return result('email_unverified')

  const candidates = await deps.findMembersByEmail(email)
  const decision = decideCandidate(candidates, userId)

  let outcome: TeamLinkOutcome
  if (decision.outcome === 'link') {
    const wrote = await deps.linkMember(decision.teamMemberId, userId)
    outcome = wrote ? 'linked' : 'lost_race'
  } else {
    outcome = decision.outcome
  }

  const final = result(
    outcome,
    decision.teamMemberId,
    email,
    candidates.map(c => c.id),
  )

  if (deps.recordOutcome && TRAILED.has(outcome)) {
    await deps.recordOutcome(final)
  }

  return final
}
