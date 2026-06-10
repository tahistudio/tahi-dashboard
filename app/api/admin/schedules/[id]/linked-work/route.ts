import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, notInArray } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/schedules/[id]/linked-work
// Returns the schedule's org work pool (requests + tasks), each item carrying
// its current scheduleRowId, so the row editor can render linked work and
// offer attach candidates in a single fetch. Org resolution: schedule.orgId,
// falling back to the linked deal's orgId. Schedules with no resolvable org
// return an empty pool with orgId null.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: scheduleId } = await params
  const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [schedule] = await drizzle
    .select({
      id: schema.projectSchedules.id,
      orgId: schema.projectSchedules.orgId,
      dealId: schema.projectSchedules.dealId,
    })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, scheduleId))
    .limit(1)

  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  let resolvedOrgId = schedule.orgId
  if (!resolvedOrgId && schedule.dealId) {
    const [deal] = await drizzle
      .select({ orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(eq(schema.deals.id, schedule.dealId))
      .limit(1)
    resolvedOrgId = deal?.orgId ?? null
  }

  if (!resolvedOrgId) {
    return NextResponse.json({ orgId: null, requests: [], tasks: [] })
  }

  const denied = await requireAccessToOrg(drizzle, userId, resolvedOrgId)
  if (denied) return denied

  const [requests, tasks] = await Promise.all([
    drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        requestNumber: schema.requests.requestNumber,
        dueDate: schema.requests.dueDate,
        scheduleRowId: schema.requests.scheduleRowId,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, resolvedOrgId),
        notInArray(schema.requests.status, ['archived', 'cancelled']),
      ))
      .orderBy(desc(schema.requests.updatedAt)),
    drizzle
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        dueDate: schema.tasks.dueDate,
        scheduleRowId: schema.tasks.scheduleRowId,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.orgId, resolvedOrgId))
      .orderBy(desc(schema.tasks.updatedAt)),
  ])

  return NextResponse.json({ orgId: resolvedOrgId, requests, tasks })
}
