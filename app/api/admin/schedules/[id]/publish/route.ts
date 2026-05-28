import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/schedules/[id]/publish
 *
 * Snapshots the current schedule + sections + rows into `publishedSnapshot`.
 * The public viewer reads from this snapshot so admin edits to the live
 * tables don't leak until the next publish. Mirrors the proposal publish
 * flow exactly.
 *
 * Idempotent — re-running just re-snapshots the latest state.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [schedule] = await database
    .select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      subtitle: schema.projectSchedules.subtitle,
      preparedFor: schema.projectSchedules.preparedFor,
      preparedBy: schema.projectSchedules.preparedBy,
      effectiveDate: schema.projectSchedules.effectiveDate,
      targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      numberOfWeeks: schema.projectSchedules.numberOfWeeks,
      overviewHtml: schema.projectSchedules.overviewHtml,
    })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [sections, rows] = await Promise.all([
    database.select({
      id: schema.scheduleSections.id,
      type: schema.scheduleSections.type,
      title: schema.scheduleSections.title,
      subtitle: schema.scheduleSections.subtitle,
      startWeek: schema.scheduleSections.startWeek,
      endWeek: schema.scheduleSections.endWeek,
      data: schema.scheduleSections.data,
      themeMode: schema.scheduleSections.themeMode,
      position: schema.scheduleSections.position,
    })
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, id))
      .orderBy(asc(schema.scheduleSections.position)),
    database.select({
      id: schema.scheduleRows.id,
      sectionId: schema.scheduleRows.sectionId,
      rowType: schema.scheduleRows.rowType,
      label: schema.scheduleRows.label,
      owner: schema.scheduleRows.owner,
      startWeek: schema.scheduleRows.startWeek,
      endWeek: schema.scheduleRows.endWeek,
      riskFlag: schema.scheduleRows.riskFlag,
      position: schema.scheduleRows.position,
    })
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.scheduleId, id))
      .orderBy(asc(schema.scheduleRows.position)),
  ])

  const snapshot = {
    schedule: {
      title: schedule.title,
      subtitle: schedule.subtitle,
      preparedFor: schedule.preparedFor,
      preparedBy: schedule.preparedBy,
      effectiveDate: schedule.effectiveDate,
      targetLaunchDate: schedule.targetLaunchDate,
      numberOfWeeks: schedule.numberOfWeeks,
      overviewHtml: schedule.overviewHtml,
    },
    sections,
    rows,
  }

  const now = new Date().toISOString()
  await database.update(schema.projectSchedules).set({
    publishedSnapshot: JSON.stringify(snapshot),
    publishedAt: now,
    updatedAt: now,
  }).where(eq(schema.projectSchedules.id, id))

  return NextResponse.json({
    publishedAt: now,
    sectionCount: sections.length,
    rowCount: rows.length,
  })
}
