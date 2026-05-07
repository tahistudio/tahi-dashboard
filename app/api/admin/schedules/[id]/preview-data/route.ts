import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/schedules/[id]/preview-data
 *
 * Returns the LIVE state of a schedule in the same shape as the public
 * endpoint, for admin-only "preview" flows. Bypasses any token check —
 * Clerk admin auth is sufficient.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
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
      status: schema.projectSchedules.status,
      orgName: schema.organisations.name,
    })
    .from(schema.projectSchedules)
    .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sections = await database
    .select()
    .from(schema.scheduleSections)
    .where(eq(schema.scheduleSections.scheduleId, id))
    .orderBy(asc(schema.scheduleSections.position))

  // Hydrate each gantt section with its rows (mirrors the public endpoint).
  const sectionsWithRows = await Promise.all(sections.map(async (s) => {
    if (s.type !== 'gantt') return s
    const rows = await database
      .select()
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.sectionId, s.id))
      .orderBy(asc(schema.scheduleRows.position))
    return { ...s, rows }
  }))

  const { id: internalId, ...safeSchedule } = schedule
  return NextResponse.json({
    schedule: safeSchedule,
    sections: sectionsWithRows,
    analyticsResourceId: internalId,
    isPreview: true,
  })
}
