/**
 * lib/acting-eligibility.ts: the one answer to "may this session act as the
 * client it is previewing".
 *
 * Three places have to agree about it, and before this file they each asked in
 * their own words:
 *   - /api/admin/impersonate/mode, which says yes or no when the operator arms
 *     the mode;
 *   - getPortalAuth, which re-proves the right on every acting write;
 *   - /api/uploads/confirm, which is admin-authenticated (so it never reaches
 *     getPortalAuth) and still has to decide whether an upload made inside a
 *     preview belongs in the `acting_as_client.*` trail.
 *
 * The third one is why this is a module rather than a private function. It
 * used to decide from the two browser cookies alone, so a Tahi admin who is
 * NOT a super admin could set the mode cookie from a console and mint rows in
 * the acting vocabulary for uploads they were already allowed to make. No
 * privilege was gained, but the trail Liam reads to answer "what did the studio
 * do inside a client's workspace" would have carried two different meanings
 * under one prefix.
 *
 * The conditions, each re-derived here rather than trusted from the browser:
 *   1. super_admin, from the roles table via resolvePermissions. Not a
 *      hardcoded list of addresses: Liam and Staci hold the role as data
 *      (lib/permissions.ts SUPER_ADMIN_ROLE), so revoking it revokes this too.
 *   2. a `team_members` row linked to the Clerk user, because an acting write
 *      has to be attributable to a person on the roster. No row, no acting.
 * The preview org is the caller's own third condition: this module never sees
 * a cookie.
 */

import { resolvePermissions } from '@/lib/permissions'
import { resolveTeamMember, type TeamMemberIdentity } from '@/lib/team-identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface ActEligibility {
  ok: boolean
  /** Why not, in words an operator can act on. Null when ok. */
  reason: string | null
  /** The roster row an acting write would be attributed to. Null when not ok. */
  member: TeamMemberIdentity | null
}

const DENIED_NOT_SIGNED_IN: ActEligibility = {
  ok: false,
  reason: 'Sign in as a Tahi Studio super admin.',
  member: null,
}

const DENIED_NOT_SUPER_ADMIN: ActEligibility = {
  ok: false,
  reason: 'Acting as a client is limited to super admins.',
  member: null,
}

const DENIED_NO_ROSTER_ROW: ActEligibility = {
  ok: false,
  // The service token is the usual traveller down this branch: it is verified
  // by TAHI_API_TOKEN and has no roster row by design, so it can never be the
  // person an acting write is attributed to.
  reason: 'Acting as a client needs a team member profile linked to your login.',
  member: null,
}

/**
 * May this Clerk identity act as a client? Throws only what the resolvers
 * throw; every caller treats a throw as a refusal, because a D1 hiccup must
 * downgrade a session to the read-only preview it was, never up.
 */
export async function resolveActEligibility(
  drizzle: Drizzle,
  userId: string | null,
  clerkOrgId: string | null,
): Promise<ActEligibility> {
  if (!userId || !clerkOrgId) return DENIED_NOT_SIGNED_IN

  const access = await resolvePermissions(
    drizzle as unknown as Parameters<typeof resolvePermissions>[0],
    { userId, orgId: clerkOrgId },
  )
  if (!access.isSuperAdmin) return DENIED_NOT_SUPER_ADMIN

  const member = await resolveTeamMember(drizzle, userId)
  if (!member) return DENIED_NO_ROSTER_ROW

  return { ok: true, reason: null, member }
}
