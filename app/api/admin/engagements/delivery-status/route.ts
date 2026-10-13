import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { scopedOrgIds } from '@/lib/access-scope'
import { requireDealAccess } from '@/app/api/admin/deals/_access'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, sql } from 'drizzle-orm'
import { aggregateDeliveryStatus, type ScheduleRef } from '@/lib/delivery-aggregate'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/engagements/delivery-status?dealId=...  (or ?orgId=...)
// Engagement-level rollup of delivery status across all the schedules attached
// to a deal (by dealId) or a client org (by orgId). Powers the engagement-health
// card on deal + client detail (Slice 4).
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const featureDenied = await requireFeature({ userId, orgId }, 'schedules')
  if (featureDenied) return featureDenied

  const url = new URL(req.url)
  const dealId = url.searchParams.get('dealId')
  const filterOrgId = url.searchParams.get('orgId')
  if (!dealId && !filterOrgId) {
    return NextResponse.json({ error: 'dealId or orgId is required' }, { status: 400 })
  }

  const drizzle = (await db()) as D1

  const denied = dealId
    ? await requireDealAccess(drizzle, { userId, orgId }, dealId)
    : await requireAccessToOrg(drizzle, userId, filterOrgId)
  if (denied) return denied
  if (dealId && filterOrgId) {
    const orgDenied = await requireAccessToOrg(drizzle, userId, filterOrgId)
    if (orgDenied) return orgDenied
  }
  const scope = await scopedOrgIds({ userId, orgId })
  const owned = scope.kind === 'all' ? undefined : scope.kind === 'none' ? sql`0 = 1`
    : sql`coalesce(${schema.projectSchedules.orgId}, (SELECT org_id FROM deals WHERE id = ${schema.projectSchedules.dealId})) IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))`

  const schedules = await drizzle
    .select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      effectiveDate: schema.projectSchedules.effectiveDate,
    })
    .from(schema.projectSchedules)
    .where(and(
      dealId ? eq(schema.projectSchedules.dealId, dealId) : eq(schema.projectSchedules.orgId, filterOrgId as string),
      owned,
    ))

  const result = await aggregateDeliveryStatus(drizzle, schedules as ScheduleRef[], new Date().toISOString(), scope)
  return NextResponse.json(result)
}
