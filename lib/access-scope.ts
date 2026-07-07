/**
 * lib/access-scope.ts
 *
 * Ergonomic wrapper over lib/access-scoping.ts for admin list routes.
 *
 * `resolveAccessScoping` returns `string[] | null`, where `null` means
 * "unrestricted" and `[]` means "deny all". That raw shape is easy to invert
 * by accident (a forgotten `.length === 0` check silently leaks every org).
 * This helper resolves the DB itself and returns a discriminated `OrgScope`
 * with named sentinels so TypeScript forces every caller to handle deny-all.
 *
 * The underlying scoping logic is NOT reimplemented here: `scopedOrgIds`
 * layers on top of `resolveAccessScoping`, so the admin bypass is inherited
 * unchanged (`{ kind: 'all' }` is returned exactly when `resolveAccessScoping`
 * returns `null` - the org owner with no `teamMembers` row, a `role === 'admin'`
 * member, or an `all_clients` rule). Single-entity routes keep using
 * `requireAccessToOrg` from lib/require-access.ts.
 *
 * Usage in an admin list route (CLAUDE.md rule 11):
 *
 *   import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
 *   import { scopedOrgIds } from '@/lib/access-scope'
 *   import { inArray } from 'drizzle-orm'
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await getRequestAuth(req)
 *     if (!isTahiAdmin(auth.orgId)) {
 *       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *     }
 *     const scope = await scopedOrgIds(auth)
 *     if (scope.kind === 'none') return NextResponse.json({ requests: [] }) // deny all
 *
 *     const database = await db()
 *     const conditions = []
 *     if (scope.kind === 'some') {
 *       conditions.push(inArray(schema.requests.orgId, scope.orgIds))
 *     }
 *     // ... run the query with conditions ...
 *   }
 */

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import type { RequestAuthResult } from '@/lib/server-auth'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * The set of org IDs a caller may see, as a discriminated union.
 *
 *   'all'  - unrestricted (admin / all_clients rule); apply no org filter
 *   'none' - deny by default (team member with no access rules); return empty
 *   'some' - restricted to `orgIds`; filter with `inArray(..., orgIds)`
 */
export type OrgScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'some'; orgIds: string[] }

/**
 * Resolve the org-ID scope for an authenticated caller.
 *
 * Accepts the `getRequestAuth` result (only `userId` is read) and resolves the
 * D1 handle internally, so list routes that don't otherwise need a `database`
 * handle stay clean. Admins bypass scoping via the inherited `resolveAccessScoping`
 * behaviour (returns `{ kind: 'all' }`).
 */
export async function scopedOrgIds(
  auth: Pick<RequestAuthResult, 'userId'>,
): Promise<OrgScope> {
  const database = await db()
  const ids = await resolveAccessScoping(database as DrizzleDB, auth.userId)
  if (ids === null) return { kind: 'all' }
  if (ids.length === 0) return { kind: 'none' }
  return { kind: 'some', orgIds: ids }
}
