/**
 * lib/team-identity.ts - who is this caller, and has this workspace been seeded
 * with roles yet?
 *
 * The two deny-by-default gates both need the same two answers:
 *   - lib/permissions.ts    decides the feature level from the caller's roles.
 *   - lib/access-scoping.ts decides which client orgs the caller may see.
 * If they disagreed about WHICH team member a Clerk user is, one gate could
 * pass while the other denies, so the lookup lives here once.
 *
 * Identity linkage is NOT a permission grant. It only decides which
 * `team_members` row the caller IS; the roles held by that row (possibly none)
 * decide what they can do. `null` means "unknown identity", and under deny by
 * default every caller must treat that as no access.
 *
 * The join itself is `team_members.clerk_user_id`, written by
 * lib/team-link-server.ts on the first dashboard render of a signed-in Tahi
 * user (verified email, never creates a row). This module deliberately only
 * READS that column: one writer, one linkage rule.
 */

import { schema } from '@/db/d1'
import { eq, isNull } from 'drizzle-orm'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * The userId `getRequestAuth` mints for a verified TAHI_API_TOKEN (the worker
 * MCP server and other service-to-service calls). It has no `team_members` row
 * by design, so every gate special-cases it instead of denying it.
 */
export const SERVICE_USER_ID = 'api-service'

export interface TeamMemberIdentity {
  id: string
  /** Legacy `team_members.role` column: 'admin' | 'member'. */
  role: string | null
}

/**
 * Resolve a Clerk user id to the team member row that IS that person, or null
 * when nothing links to it (a Tahi-org login with no roster row, or a roster
 * row that has not been claimed yet). Fail closed: callers deny on null.
 */
export async function resolveTeamMember(
  database: DrizzleDB,
  userId: string | null,
): Promise<TeamMemberIdentity | null> {
  if (!userId || userId === SERVICE_USER_ID) return null

  const [member] = await database
    .select({ id: schema.teamMembers.id, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  return member ? { id: member.id, role: member.role ?? null } : null
}

/**
 * True when at least one ACTIVE role assignment exists anywhere in the
 * workspace.
 *
 * BOOTSTRAP SAFETY NET, reached only on a deny path: a fresh or unseeded
 * install (local D1, a new environment, a rolled-back seed) has no assignments
 * at all, so denying every caller would lock the operator out of the very
 * screen where roles are granted. Production has assignments, so this returns
 * true there and the deny stands.
 */
export async function hasAnyActiveRoleAssignment(database: DrizzleDB): Promise<boolean> {
  const rows = await database
    .select({ id: schema.teamMemberRoles.id })
    .from(schema.teamMemberRoles)
    .where(isNull(schema.teamMemberRoles.endedAt))
    .limit(1)
  return rows.length > 0
}
