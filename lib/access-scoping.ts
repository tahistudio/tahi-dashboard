/**
 * lib/access-scoping.ts
 *
 * Resolves team member access scoping rules.
 * Returns null if the user has unrestricted access (all_clients scope or admin role).
 * Returns an array of org IDs if the user is restricted to specific clients.
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Resolve access scoping for a given user.
 *
 * @returns null if unrestricted (all clients), or string[] of allowed org IDs
 */
export async function resolveAccessScoping(
  database: DrizzleDB,
  userId: string | null
): Promise<string[] | null> {
  if (!userId) return null // No user context, allow all (auth check happens elsewhere)

  // Find team member record for this Clerk user
  const teamMemberRows = await database
    .select({ id: schema.teamMembers.id, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  // If no team member record found, they might be an admin without a record
  if (teamMemberRows.length === 0) return null

  const teamMember = teamMemberRows[0]

  // Admins bypass all scoping
  if (teamMember.role === 'admin') return null

  // Look up access rules for this team member
  const accessRules = await database
    .select()
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, teamMember.id))

  // No access rules means deny by default - return empty array
  if (accessRules.length === 0) return []

  // Check if any rule grants all_clients access
  const hasAllClients = accessRules.some(r => r.scopeType === 'all_clients')
  if (hasAllClients) return null

  // Collect allowed org IDs
  const allowedOrgIds = new Set<string>()

  for (const rule of accessRules) {
    if (rule.scopeType === 'specific_clients') {
      // Look up the specific orgs for this access rule
      const accessOrgs = await database
        .select({ orgId: schema.teamMemberAccessOrgs.orgId })
        .from(schema.teamMemberAccessOrgs)
        .where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))

      for (const ao of accessOrgs) {
        allowedOrgIds.add(ao.orgId)
      }
    } else if (rule.scopeType === 'plan_type' && rule.planType) {
      // Look up orgs with this plan type
      const planOrgs = await database
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(eq(schema.organisations.planType, rule.planType))

      for (const org of planOrgs) {
        allowedOrgIds.add(org.id)
      }
    }
  }

  return Array.from(allowedOrgIds)
}
