import { NextResponse } from 'next/server'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import { scopedOrgIds, type OrgScope } from '@/lib/access-scope'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireDealAccess } from '@/app/api/admin/deals/_access'
import { orgLiteralInScope as orgColumnInScope } from '@/lib/route-org-filter'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

export function calculationScopeCondition(scope: OrgScope, org: SQLiteColumn, deal: SQLiteColumn) {
  if (scope.kind === 'all') return undefined
  if (scope.kind === 'none') return sql`0 = 1`
  return and(
    or(isNotNull(org), isNotNull(deal)),
    orgColumnInScope(org, scope.orgIds, { includeNull: true }),
    or(isNull(deal), sql`${deal} IN (SELECT ${schema.deals.id} FROM ${schema.deals}
      WHERE ${orgColumnInScope(schema.deals.orgId, scope.orgIds, { includeNull: true })})`),
  )
}

export async function requireCalculationTarget(database: Database, auth: Auth, target: { orgId?: string | null; dealId?: string | null }) {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  if (scope.kind === 'none' || (!target.orgId && !target.dealId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (target.orgId) {
    const denied = await requireAccessToOrg(database, auth.userId, target.orgId)
    if (denied) return denied
  }
  if (target.dealId) return requireDealAccess(database, auth, target.dealId)
  return null
}

export async function requireCalculationAccess(database: Database, auth: Auth, id: string) {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  const [target] = await database.select({ orgId: schema.projectCalculations.orgId, dealId: schema.projectCalculations.dealId })
    .from(schema.projectCalculations).where(eq(schema.projectCalculations.id, id)).limit(1)
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return requireCalculationTarget(database, auth, target)
}
