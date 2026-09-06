/**
 * lib/onboarding-lead-server.ts - D1 wiring for lib/onboarding-lead.ts.
 *
 * Split from the decision core so the resolution order stays testable in a
 * plain node environment, the same shape as lib/team-link-server.ts.
 */

import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import {
  DEFAULT_STUDIO_LEAD,
  resolveStudioLead,
  type StudioLead,
  type StudioLeadCandidate,
  type StudioLeadDeps,
} from '@/lib/onboarding-lead'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The roles table name that means "the owners". Matches lib/permissions.ts. */
const SUPER_ADMIN_ROLE = 'super_admin'

export function buildStudioLeadDeps(drizzle: Drizzle): StudioLeadDeps {
  return {
    /**
     * The org's project_manager, in one join: the access rule, its org link and
     * the member it names. Identical to GET /api/admin/clients/[id]/pm, so the
     * onboarding card and the client detail page read the same assignment.
     *
     * The org reference arrives in two shapes and both must land on the same
     * row: the D1 uuid (from an invite) or the raw Clerk org id (from the
     * session). `team_member_access_orgs.orgId` is keyed on the D1 id only, so
     * the Clerk id is resolved first.
     */
    findPmForOrg: async (orgRef: string): Promise<StudioLeadCandidate | null> => {
      const [org] = await drizzle
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(or(
          eq(schema.organisations.id, orgRef),
          eq(schema.organisations.clerkOrgId, orgRef),
        ))
        .limit(1)
      if (!org) return null

      const [row] = await drizzle
        .select({
          id: schema.teamMembers.id,
          name: schema.teamMembers.name,
          email: schema.teamMembers.email,
          avatarUrl: schema.teamMembers.avatarUrl,
        })
        .from(schema.teamMemberAccess)
        .innerJoin(
          schema.teamMemberAccessOrgs,
          eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id),
        )
        .innerJoin(
          schema.teamMembers,
          eq(schema.teamMembers.id, schema.teamMemberAccess.teamMemberId),
        )
        .where(and(
          eq(schema.teamMemberAccess.role, 'project_manager'),
          eq(schema.teamMemberAccessOrgs.orgId, org.id),
        ))
        .limit(1)
      return row ? { ...row, avatarUrl: row.avatarUrl ?? null } : null
    },

    /**
     * The oldest active super_admin. Ordered by createdAt then name so two
     * owners (Liam and Staci both hold the role) resolve to the same person on
     * every request rather than to whatever the planner returned.
     */
    findFirstSuperAdmin: async (): Promise<StudioLeadCandidate | null> => {
      const [row] = await drizzle
        .select({
          id: schema.teamMembers.id,
          name: schema.teamMembers.name,
          email: schema.teamMembers.email,
          avatarUrl: schema.teamMembers.avatarUrl,
        })
        .from(schema.teamMemberRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.teamMemberRoles.roleId))
        .innerJoin(
          schema.teamMembers,
          eq(schema.teamMembers.id, schema.teamMemberRoles.teamMemberId),
        )
        .where(and(
          eq(schema.roles.name, SUPER_ADMIN_ROLE),
          isNull(schema.teamMemberRoles.endedAt),
        ))
        .orderBy(asc(schema.teamMembers.createdAt), asc(schema.teamMembers.name))
        .limit(1)
      return row ? { ...row, avatarUrl: row.avatarUrl ?? null } : null
    },
  }
}

/**
 * The studio lead for a client, resolved server-side.
 *
 * Never throws: a D1 outage degrades to DEFAULT_STUDIO_LEAD, which is exactly
 * the card the screen rendered before this lookup existed.
 */
export async function loadStudioLead(orgRef: string | null | undefined): Promise<StudioLead> {
  try {
    const drizzle = (await db()) as unknown as Drizzle
    return await resolveStudioLead(buildStudioLeadDeps(drizzle), orgRef)
  } catch {
    return DEFAULT_STUDIO_LEAD
  }
}
