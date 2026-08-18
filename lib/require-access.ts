/**
 * lib/require-access.ts
 *
 * Guard helpers for admin API routes that operate on a specific org's data.
 *
 * Builds on lib/access-scoping.ts (which lists allowed org IDs for a user)
 * and returns a NextResponse 403/404 when the current user is not allowed
 * to see the target org.
 *
 * Usage in a route handler:
 *
 *   const { orgId: authOrgId, userId } = await getRequestAuth(req)
 *   if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *
 *   const database = await db() as D1
 *   const targetOrgId = await findTargetOrgIdForEntity(database, 'request', params.id)
 *   const denied = await requireAccessToOrg(database, userId, targetOrgId)
 *   if (denied) return denied
 *
 * DENY BY DEFAULT (see lib/access-scoping.ts for the full decision order).
 * Bypassing scoping has to be earned: an active admin / super_admin role, an
 * all_clients rule, or the MCP service token. A team member with no access
 * rule, and an identity with no team_members row, are both denied.
 */

import { NextResponse } from 'next/server'
import { resolveAccessScoping } from '@/lib/access-scoping'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Check whether the authenticated user has access to the given org.
 * Returns a 403 NextResponse if denied, otherwise null.
 * A null targetOrgId means the entity couldn't be located; returns 404.
 */
export async function requireAccessToOrg(
  database: DrizzleDB,
  userId: string | null,
  targetOrgId: string | null | undefined,
): Promise<NextResponse | null> {
  if (!targetOrgId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const allowedOrgIds = await resolveAccessScoping(database, userId)

  // null = unrestricted (admin / super_admin role, all_clients rule, service
  // token, or an unseeded workspace). Anything else, including [], is a filter.
  if (allowedOrgIds === null) return null

  if (!allowedOrgIds.includes(targetOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

/**
 * Convenience: throws-style guard that returns the allowed-org-ids list
 * (or null for unrestricted) so a caller can add it as a SQL IN filter.
 *
 *   const scope = await getOrgScope(database, userId)
 *   if (scope !== null) conditions.push(inArray(schema.invoices.orgId, scope))
 *
 * Returns [] for "no access at all" (the default for an unroled or unknown
 * caller); callers should early-return with an empty result set rather than
 * running the query.
 */
export async function getOrgScope(
  database: DrizzleDB,
  userId: string | null,
): Promise<string[] | null> {
  return resolveAccessScoping(database, userId)
}
