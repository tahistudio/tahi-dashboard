import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── GET /api/admin/schedules/[id] ──────────────────────────────────────
// Returns the schedule + all its rows in display order.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [scheduleRow] = await database
    .select({
      id: schema.projectSchedules.id,
      orgId: schema.projectSchedules.orgId,
      dealId: schema.projectSchedules.dealId,
      title: schema.projectSchedules.title,
      subtitle: schema.projectSchedules.subtitle,
      preparedFor: schema.projectSchedules.preparedFor,
      preparedBy: schema.projectSchedules.preparedBy,
      effectiveDate: schema.projectSchedules.effectiveDate,
      targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      numberOfWeeks: schema.projectSchedules.numberOfWeeks,
      overviewHtml: schema.projectSchedules.overviewHtml,
      status: schema.projectSchedules.status,
      publicShareToken: schema.projectSchedules.publicShareToken,
      publicSharedAt: schema.projectSchedules.publicSharedAt,
      createdAt: schema.projectSchedules.createdAt,
      updatedAt: schema.projectSchedules.updatedAt,
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
    })
    .from(schema.projectSchedules)
    .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.projectSchedules.dealId, schema.deals.id))
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)

  if (!scheduleRow) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const rows = await database
    .select()
    .from(schema.scheduleRows)
    .where(eq(schema.scheduleRows.scheduleId, id))
    .orderBy(asc(schema.scheduleRows.position))

  return NextResponse.json({ schedule: scheduleRow, rows })
}

// ── PATCH /api/admin/schedules/[id] ────────────────────────────────────
// Partial update of top-level fields. Row mutations live on /rows endpoints.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    subtitle?: string | null
    orgId?: string | null
    dealId?: string | null
    preparedFor?: string | null
    preparedBy?: string | null
    effectiveDate?: string | null
    targetLaunchDate?: string | null
    numberOfWeeks?: number
    overviewHtml?: string | null
    status?: 'draft' | 'shared' | 'archived'
  }

  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.subtitle !== undefined) updates.subtitle = body.subtitle?.trim() ?? null
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.dealId !== undefined) updates.dealId = body.dealId
  if (body.preparedFor !== undefined) updates.preparedFor = body.preparedFor?.trim() ?? null
  if (body.preparedBy !== undefined) updates.preparedBy = body.preparedBy?.trim() ?? null
  if (body.effectiveDate !== undefined) updates.effectiveDate = body.effectiveDate
  if (body.targetLaunchDate !== undefined) updates.targetLaunchDate = body.targetLaunchDate
  if (body.numberOfWeeks !== undefined) {
    updates.numberOfWeeks = Math.max(1, Math.min(52, body.numberOfWeeks))
  }
  if (body.overviewHtml !== undefined) updates.overviewHtml = body.overviewHtml
  if (body.status !== undefined) updates.status = body.status

  await database.update(schema.projectSchedules).set(updates).where(eq(schema.projectSchedules.id, id))
  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/schedules/[id] ───────────────────────────────────
// Hard delete. Cascades to schedule_rows (FK ON DELETE CASCADE).
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.projectSchedules).where(eq(schema.projectSchedules.id, id))
  return NextResponse.json({ success: true })
}
