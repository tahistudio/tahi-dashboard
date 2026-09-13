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
 * Like requireAccessToOrg, but for a link whose target may legitimately
 * carry no organisation at all: a lead (no orgId column on the table) or a
 * pre-client deal (orgId nullable). Passing `null` here must mean "this
 * link genuinely has no org", never "the entity wasn't found"; resolve
 * existence separately before calling this.
 *
 * Mirrors the "allow-if-any-scope" convention used by the /calls index
 * (see app/api/admin/calls/index/route.ts and
 * app/api/admin/_scoping/org-scope.ts): an org-less target is visible to
 * any caller who has SOME access (a specific_clients or plan_type rule),
 * and denied only to a caller with zero access at all (no rule
 * configured, deny-by-default). A non-null orgId behaves exactly like
 * requireAccessToOrg.
 */
export async function requireAccessToOrgOrPreClient(
  database: DrizzleDB,
  userId: string | null,
  orgId: string | null,
): Promise<NextResponse | null> {
  if (orgId) return requireAccessToOrg(database, userId, orgId)

  const allowedOrgIds = await resolveAccessScoping(database, userId)

  // null = unrestricted. A non-null, empty list means "no access rule
  // configured at all" (deny-by-default) - that caller cannot reach an
  // org-less row either. Any non-empty list means the caller has SOME
  // access, which is enough for an org-less link.
  if (allowedOrgIds !== null && allowedOrgIds.length === 0) {
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
