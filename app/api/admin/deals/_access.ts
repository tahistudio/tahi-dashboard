/**
 * app/api/admin/deals/_access.ts
 *
 * Per-org access guards for the deals tree.
 *
 * NULL-ORG RULE: a deal with `orgId = null` is an unassigned pipeline
 * opportunity. It belongs to no client tenant, so showing it cannot leak one
 * client's data to another, and hiding it would break the board for a scoped
 * PM (every deal starts unlinked). Unlinked deals are therefore visible to any
 * caller who has at least one org in scope, and invisible to a caller scoped to
 * nothing. Deals that ARE linked to an org follow that org's scope exactly.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { scopedOrgIds } from '@/lib/access-scope'
import { isOrgInScope } from '../_scoping/org-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

/** Guard a deal org that the caller has already loaded. */
export async function denyIfDealOrgOutOfScope(
  auth: Auth,
  dealOrgId: string | null,
): Promise<NextResponse | null> {
  const scope = await scopedOrgIds(auth)
  if (!isOrgInScope(scope, dealOrgId, 'allow-if-any-scope')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/** Load a deal and guard it in one step. 404s when the deal does not exist. */
export async function requireDealAccess(
  database: D1,
  auth: Auth,
  dealId: string,
): Promise<NextResponse | null> {
  const [deal] = await database
    .select({ orgId: schema.deals.orgId })
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId))
    .limit(1)

  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  return denyIfDealOrgOutOfScope(auth, deal.orgId)
}
