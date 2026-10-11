/**
 * lib/slack/entitlement.ts
 *
 * The dashboard's own access rules, asked from Slack. A Slack user is an email
 * matched to a team_members or contacts row, not a Clerk session, so the
 * route guards the dashboard runs (requireAccessToOrg, requirePortalFeature)
 * never see a Slack press or a Slack note. These two answers are those guards,
 * keyed on what Slack does know, so Slack is never the side door around them.
 *
 *   studioReachesOrg       A current studio role, feature grants and the
 *                          organisation scope used by dashboard guards.
 *                          Asked before notes read context, before decisions,
 *                          and before work-sync posts or rewrites a copy.
 *
 *   clientMayFileRequests  The portal's 'requests' feature gate for a client:
 *                          every portal request route runs
 *                          requirePortalFeature(..., 'requests'). Asked before
 *                          a client is offered a draft card and again when
 *                          they press Approve on one.
 *
 * Both deny by default: anything that cannot be read is a refusal.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { can, contactCanSeeFeature, resolvePermissions } from '@/lib/permissions'
import { SERVICE_USER_ID } from '@/lib/team-identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The portal feature a client's draft files into. */
export const CLIENT_REQUESTS_FEATURE = 'requests'

/**
 * Whether a studio person can reach a client.
 *
 * Scoping keys on the Clerk user id, so the team member's own is read first.
 * An active role and the requested feature grants are required even for
 * studio housekeeping. A null client needs some organisation access, as
 * requireAccessToOrgOrPreClient does. Cached Slack levels are not grants.
 */
export async function studioReachesOrg(
  drizzle: Drizzle,
  teamMemberId: string,
  orgId: string | null,
  features: readonly ('tasks' | 'requests')[],
  options: {
    founderOnly?: boolean
    scopeOf?: typeof resolveAccessScoping
  } = {},
): Promise<boolean> {
  try {
    const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
    if (!tahiOrgId || !teamMemberId || features.length === 0) return false
    const [member] = await drizzle
      .select({ clerkUserId: schema.teamMembers.clerkUserId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, teamMemberId))
      .limit(1)
    if (!member?.clerkUserId || member.clerkUserId === SERVICE_USER_ID) return false
    const roles = await drizzle
      .select({ name: schema.roles.name })
      .from(schema.teamMemberRoles)
      .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
      .where(and(
        eq(schema.teamMemberRoles.teamMemberId, teamMemberId),
        isNull(schema.teamMemberRoles.endedAt),
      ))
    if (roles.length === 0 || (options.founderOnly && !roles.some(role => role.name === 'super_admin'))) return false
    const access = await resolvePermissions(drizzle, { userId: member.clerkUserId, orgId: tahiOrgId })
    if (!features.every(feature => can(access, feature))) return false
    const scope = await (options.scopeOf ?? resolveAccessScoping)(drizzle, member.clerkUserId)
    return scope === null || (orgId ? scope.includes(orgId) : scope.length > 0)
  } catch {
    return false
  }
}

/**
 * Whether a client may file a request at their client, by the portal's rule.
 *
 * A client's Approve in Slack files a real request (createRequestRecord, as
 * 'system'), so a contact or org whose Requests feature is denied in
 * feature_visibility, and who gets a 403 in the portal, gets the refusal here
 * too. Read by contact id (contactCanSeeFeature), which also holds a contact
 * with no portal login to their own contact rows. A contact that is not at
 * `orgId`, and a read that throws, is false.
 */
export async function clientMayFileRequests(
  drizzle: Drizzle,
  contactId: string | null,
  orgId: string | null,
): Promise<boolean> {
  try {
    return await contactCanSeeFeature(drizzle, { contactId, orgId }, CLIENT_REQUESTS_FEATURE)
  } catch {
    return false
  }
}
