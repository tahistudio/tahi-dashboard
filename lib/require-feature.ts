/**
 * lib/require-feature.ts - route-ergonomic feature guard for admin API routes.
 *
 * A thin `requireFeature(auth, featureKey)` that resolves the D1 handle itself
 * and returns a ready-to-return 403 `NextResponse` when the caller cannot see a
 * given FEATURE_TREE key, or `null` to continue. Mirrors the ergonomics of
 * `requireAccessToOrg` (lib/require-access.ts) and `scopedOrgIds`
 * (lib/access-scope.ts), so a route enforces a feature in one line:
 *
 *   import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
 *   import { requireFeature } from '@/lib/require-feature'
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await getRequestAuth(req)
 *     if (!isTahiAdmin(auth.orgId)) {
 *       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *     }
 *     const denied = await requireFeature(auth, 'financial_reports')
 *     if (denied) return denied
 *     // ... the caller can see this feature; run the handler ...
 *   }
 *
 * Or declaratively via `defineAdminRoute(handler, { feature: 'financial_reports' })`.
 *
 * Relationship to lib/require-permission.ts: that module exposes a lower-level
 * `requireFeature(drizzle, auth, key) -> { denied, access }` for callers that
 * already hold a drizzle handle and want the resolved `ResolvedAccess` back.
 * This module is the convenience variant that resolves D1 for you and returns
 * just the `NextResponse | null`, which is what a route usually wants.
 *
 * SECURITY INVARIANT (never violate): the studio owner + super-admins and the
 * MCP service token ALWAYS pass. The explicit short-circuits below guarantee it
 * independently of the role/permission tables, so a mid-migration or rolled-back
 * seed can never lock them out. Non-super-admin team members are gated by their
 * role's features (this is the whole point of granular permissions); denying a
 * scoped team member a feature does NOT violate the invariant.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions, can } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Guard a caller against a FEATURE_TREE key.
 *
 * @returns a 403 `NextResponse` if the caller cannot see `featureKey`, else
 *          `null` (allowed - continue the handler).
 */
export async function requireFeature(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  featureKey: string,
): Promise<NextResponse | null> {
  // INVARIANT: MCP / service-to-service token ALWAYS passes. `getRequestAuth`
  // mints userId 'api-service' ONLY for a verified TAHI_API_TOKEN, and MCP
  // parity (CLAUDE.md rule 14) requires it never be feature-gated. Checked
  // before any DB read so it holds even if the permission tables are empty.
  if (auth.userId === 'api-service') return null

  const database = await db()
  const access = await resolvePermissions(database as DrizzleDB, {
    userId: auth.userId,
    orgId: auth.orgId,
  })

  // INVARIANT: super-admins (seeded owner business@ + staci@) are un-lockable.
  // `decideFeature` already lets them pass every team/shared feature; this
  // explicit check additionally covers any feature key and proves the invariant
  // in code so it cannot be regressed by a change to the decision core.
  if (access.isSuperAdmin) return null

  // admin level (explicit admin role, or the Tahi-org "no role assigned"
  // default) passes team/shared features via `can`; team members are gated by
  // their role baseline + feature_visibility overrides.
  if (can(access, featureKey)) return null

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
