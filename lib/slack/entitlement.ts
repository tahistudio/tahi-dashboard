/**
 * lib/slack/entitlement.ts
 *
 * The dashboard's own access rules, asked from Slack. A Slack user is an email
 * matched to a team_members or contacts row, not a Clerk session, so the
 * route guards the dashboard runs (requireAccessToOrg, requirePortalFeature)
 * never see a Slack press or a Slack note. These two answers are those guards,
 * keyed on what Slack does know, so Slack is never the side door around them.
 *
 *   studioReachesOrg       CLAUDE.md rule 11 for a studio person: the access
 *                          scoping the decide route applies through
 *                          guardSuggestion. Asked on a studio press, and on a
 *                          studio note that names a client before the
 *                          suggester reads that client's open work.
 *
 *   clientMayFileRequests  The portal's 'requests' feature gate for a client:
 *                          every portal request route runs
 *                          requirePortalFeature(..., 'requests'). Asked before
 *                          a client is offered a draft card and again when
 *                          they press Approve on one.
 *
 * Both deny by default: anything that cannot be read is a refusal.
 */

import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { contactCanSeeFeature } from '@/lib/permissions'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The portal feature a client's draft files into. */
export const CLIENT_REQUESTS_FEATURE = 'requests'

/**
 * Whether a studio person can reach a client.
 *
 * Scoping keys on the Clerk user id, so the team member's own is read first.
 * No client (studio housekeeping) is open, as it is in the dashboard. A
 * founder holding super_admin resolves to unrestricted. A member with no
 * Clerk login, and a lookup that throws, is false.
 */
export async function studioReachesOrg(
  drizzle: Drizzle,
  teamMemberId: string,
  orgId: string | null,
): Promise<boolean> {
  if (!orgId) return true
  try {
    const [member] = await drizzle
      .select({ clerkUserId: schema.teamMembers.clerkUserId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, teamMemberId))
      .limit(1)
    const scope = await resolveAccessScoping(drizzle, member?.clerkUserId ?? null)
    return scope === null || scope.includes(orgId)
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
