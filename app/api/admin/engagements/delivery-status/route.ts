import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { aggregateDeliveryStatus, type ScheduleRef } from '@/lib/delivery-aggregate'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/engagements/delivery-status?dealId=...  (or ?orgId=...)
// Engagement-level rollup of delivery status across all the schedules attached
// to a deal (by dealId) or a client org (by orgId). Powers the engagement-health
// card on deal + client detail (Slice 4).
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const dealId = url.searchParams.get('dealId')
  const filterOrgId = url.searchParams.get('orgId')
  if (!dealId && !filterOrgId) {
    return NextResponse.json({ error: 'dealId or orgId is required' }, { status: 400 })
  }

  const drizzle = (await db()) as D1

  const schedules = await drizzle
    .select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      effectiveDate: schema.projectSchedules.effectiveDate,
    })
    .from(schema.projectSchedules)
    .where(dealId
      ? eq(schema.projectSchedules.dealId, dealId)
      : eq(schema.projectSchedules.orgId, filterOrgId as string),
    )

  const result = await aggregateDeliveryStatus(drizzle, schedules as ScheduleRef[], new Date().toISOString())
  return NextResponse.json(result)
}
