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
import { resolvePermissions, can, clientCanSeeFeature } from '@/lib/permissions'
import type { RequestAuthResult } from '@/lib/server-auth'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Guard a caller against a FEATURE_TREE key, or against SEVERAL at once.
 *
 * Pass an array when a route straddles two surfaces (POST /api/admin/derive-billing
 * rewrites client billing fields AND is a money operation): every key must pass
 * and they share ONE `resolvePermissions` call, so the stricter gate costs no
 * extra D1 reads.
 *
 * @returns a 403 `NextResponse` if the caller cannot see `featureKey` (or any
 *          key in the array), else `null` (allowed - continue the handler).
 */
export async function requireFeature(
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  featureKey: string | readonly string[],
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

  // admin level (an explicit admin role, or an unseeded workspace where no role
  // assignment exists anywhere) passes team/shared features via `can`; team
  // members are gated by their role baseline + feature_visibility overrides,
  // and a roleless member on a seeded workspace is denied every key.
  const keys = typeof featureKey === 'string' ? [featureKey] : featureKey
  if (keys.every(key => can(access, key))) return null

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** The subset of `getPortalAuth`'s result a portal feature check needs. */
export interface PortalFeatureAuth {
  userId: string | null
  /**
   * The RESOLVED D1 organisation id (getPortalAuth's `orgId`). A raw Clerk org
   * id also resolves correctly (`resolvePermissions` normalises either shape),
   * which is what keeps the nav, the page guards and this route guard agreeing.
   */
  orgId: string | null
  /** The caller's Clerk org, which is the Tahi org when an admin is previewing. */
  clerkOrgId?: string | null
  impersonating?: boolean
}

/**
 * Guard a PORTAL route against a client-audience FEATURE_TREE key.
 *
 * Denying a client org a feature in the permissions builder used to remove it
 * from their nav only: a deep link or a direct fetch still served the data
 * (audit item T1.18). Call this after the standard portal auth gate so the
 * denial is enforced on the data as well:
 *
 *   export const GET = definePortalRoute(async (req, auth) => {
 *     const denied = await requirePortalFeature(auth, 'requests')
 *     if (denied) return denied
 *     // ... this client can see Requests; run the handler ...
 *   })
 *
 * SECURITY INVARIANT (never violate): this narrows a CLIENT only. The MCP
 * service token and the studio's own identities always pass, so a client-side
 * deny can never lock the studio out of its own data:
 *   - `api-service` (verified TAHI_API_TOKEN) passes, as in `requireFeature`;
 *   - a caller whose Clerk org is the Tahi org passes. That is an admin
 *     previewing a client portal (`impersonating`), and previewing is
 *     read-only elsewhere, so it can only ever read.
 *
 * KNOWN RESIDUE (pre-existing, out of this slice): that second short-circuit is
 * Tahi-org MEMBERSHIP, and the `tahi-impersonate-org` cookie `getPortalAuth`
 * trusts is written client-side by impersonation-banner.tsx rather than by a
 * permission-checked endpoint. So a roleless or narrowly scoped team member who
 * is now refused every admin route can still set that cookie by hand and READ a
 * client's portal data. Closing it means gating the impersonation branch on an
 * actual grant and moving the cookie write behind an API route that checks the
 * same thing.
 *
 * @returns a 403 `NextResponse` when the client's org (or their own contact
 *          row) denies `featureKey`, else `null` (allowed - continue).
 */
export async function requirePortalFeature(
  auth: PortalFeatureAuth,
  featureKey: string,
): Promise<NextResponse | null> {
  if (auth.userId === 'api-service') return null

  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (tahiOrgId && (auth.clerkOrgId === tahiOrgId || auth.orgId === tahiOrgId)) return null

  const database = await db()
  const allowed = await clientCanSeeFeature(database as DrizzleDB, {
    userId: auth.userId,
    orgId: auth.orgId,
  }, featureKey)
  if (allowed) return null

  // Machine-readable WHY, on top of the bare message. A portal 403 has several
  // meanings and the client pages have to say the right sentence: this one is
  // "your workspace does not have this feature", which is NOT "ask your
  // organisation admin" (the reader may BE the admin). lib/portal-admin-label
  // classifies on this code.
  return NextResponse.json({ error: 'Forbidden', code: 'feature_disabled' }, { status: 403 })
}
