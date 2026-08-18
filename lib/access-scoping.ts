/**
 * lib/access-scoping.ts
 *
 * Resolves team member access scoping rules: WHICH client orgs a caller may
 * see. Returns null for unrestricted access, or an array of org IDs.
 *
 * DENY BY DEFAULT. An empty array (deny all) is the answer for any caller we
 * cannot positively place: no user context, an unknown identity, or a member
 * with no access rule. Unrestricted access has to be earned by an admin /
 * super_admin role, an `all_clients` rule, or one of two explicit exceptions:
 *   - the MCP service token, which has no team_members row by design;
 *   - a workspace with no active role assignment anywhere (unseeded install),
 *     where denying would lock the operator out of their own data.
 */

import { schema } from '@/db/d1'
import { and, eq, isNull } from 'drizzle-orm'
import {
  SERVICE_USER_ID,
  hasAnyActiveRoleAssignment,
  resolveTeamMember,
} from '@/lib/team-identity'

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
  // Service / automation identity first: getRequestAuth mints this id ONLY for
  // a verified TAHI_API_TOKEN (worker MCP, service-to-service), and it has no
  // team_members row, so it must be answered before any lookup or it would
  // fall into the unknown-identity deny below.
  if (userId === SERVICE_USER_ID) return null

  // No user context -> deny. Every caller reaches this behind
  // isTahiAdmin(getRequestAuth(req).orgId), and getRequestAuth only ever
  // returns an orgId together with a userId, so a null userId here means the
  // caller lost its auth context rather than that it is a system job.
  if (!userId) return []

  const teamMember = await resolveTeamMember(database, userId)

  // Unknown identity (no team_members row links to this Clerk user). Deny,
  // except on an unseeded install where nobody could grant themselves a role.
  if (!teamMember) {
    return (await hasAnyActiveRoleAssignment(database)) ? [] : null
  }

  // The new team_member_roles system is the source of truth. Decide by the
  // NAMES of the member's new-system roles:
  //   - admin / super_admin role in the new system -> unrestricted. This is
  //     what keeps the studio owner whole: his own teamMemberAccess row is a
  //     narrow specific_clients scope, and only this rule stops it from
  //     shrinking him to that one client.
  //   - any scoped (non-admin) role -> the legacy 'admin' column must NOT
  //     short-circuit to unrestricted; the member was deliberately downgraded
  //     and their teamMemberAccess rules govern.
  // Only ACTIVE role assignments count (isNull endedAt, mirroring
  // lib/permissions.ts): an ended admin role must not keep granting
  // unrestricted data scope after revocation.
  const newSystemRoles = await database
    .select({ name: schema.roles.name })
    .from(schema.teamMemberRoles)
    .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
    .where(and(
      eq(schema.teamMemberRoles.teamMemberId, teamMember.id),
      isNull(schema.teamMemberRoles.endedAt),
    ))
  const roleNames = newSystemRoles.map((r) => r.name)
  if (roleNames.includes('admin') || roleNames.includes('super_admin')) return null
  const hasScopedNewRole = roleNames.length > 0

  // Legacy `team_members.role` column. It predates the roles table, the team
  // form still writes it, and it is NOT a permission grant, so once the roles
  // table is seeded it no longer buys unrestricted scope: such a member falls
  // through to their access rules like anyone else. On an unseeded install it
  // is still the only signal there is, so it counts there.
  if (teamMember.role === 'admin' && !hasScopedNewRole) {
    if (!(await hasAnyActiveRoleAssignment(database))) return null
  }

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
