import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

/**
 * Public read-only schedule endpoint. No auth — token validates access.
 *
 * Returns 404 (not 401/403) on missing or revoked tokens so the existence
 * of a schedule isn't leaked to attackers probing tokens.
 *
 * Only fields safe to share publicly are returned: no internal IDs, no
 * audit fields, no created_by_id. Org / deal references collapse to display
 * names.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params

  // Basic shape check — our tokens are 32 url-safe base64 chars.
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const database = await db() as unknown as D1

  const [scheduleRow] = await database
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
    .where(eq(schema.projectSchedules.publicShareToken, token))
    .limit(1)

  if (!scheduleRow || scheduleRow.status !== 'shared') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Sectioned schedules (migration 0026). Public viewer renders one slide
  // per section; each gantt section gets its rows nested in.
  const [sectionRows, allRows] = await Promise.all([
    database
      .select({
        id: schema.scheduleSections.id,
        type: schema.scheduleSections.type,
        title: schema.scheduleSections.title,
        subtitle: schema.scheduleSections.subtitle,
        startWeek: schema.scheduleSections.startWeek,
        endWeek: schema.scheduleSections.endWeek,
        data: schema.scheduleSections.data,
        position: schema.scheduleSections.position,
      })
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, scheduleRow.id))
      .orderBy(asc(schema.scheduleSections.position)),
    database
      .select({
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
      .where(eq(schema.scheduleRows.scheduleId, scheduleRow.id))
      .orderBy(asc(schema.scheduleRows.position)),
  ])

  const rowsBySection = new Map<string, typeof allRows>()
  for (const r of allRows) {
    const key = r.sectionId ?? '__unsectioned__'
    const arr = rowsBySection.get(key) ?? []
    arr.push(r)
    rowsBySection.set(key, arr)
  }

  const sections = sectionRows.map(s => ({
    ...s,
    rows: s.type === 'gantt' ? (rowsBySection.get(s.id) ?? []) : [],
  }))

  // Strip the internal ID from the shared schedule object; expose via
  // analyticsResourceId for the view-tracking hook only.
  const { id: internalId, ...safeSchedule } = scheduleRow
  return NextResponse.json({
    schedule: safeSchedule,
    sections,
    // Back-compat for the old single-section public viewer.
    rows: allRows,
    analyticsResourceId: internalId,
  })
}
