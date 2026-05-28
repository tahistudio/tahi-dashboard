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
      publishedSnapshot: schema.projectSchedules.publishedSnapshot,
      orgName: schema.organisations.name,
    })
    .from(schema.projectSchedules)
    .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
    .where(eq(schema.projectSchedules.publicShareToken, token))
    .limit(1)

  if (!scheduleRow || scheduleRow.status !== 'shared') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Draft / publish: if a published snapshot exists, return it. Otherwise
  // fall back to the live tables (back-compat with schedules created
  // before migration 0054 / never explicitly published).
  if (scheduleRow.publishedSnapshot) {
    try {
      const snapshot = JSON.parse(scheduleRow.publishedSnapshot) as {
        schedule: {
          title: string
          subtitle: string | null
          preparedFor: string | null
          preparedBy: string | null
          effectiveDate: string | null
          targetLaunchDate: string | null
          numberOfWeeks: number
          overviewHtml: string | null
        }
        sections: Array<{
          id: string
          type: string
          title: string | null
          subtitle: string | null
          startWeek: number | null
          endWeek: number | null
          data: unknown
          themeMode?: string | null
          position: number
        }>
        rows: Array<{
          id: string
          sectionId: string | null
          rowType: string
          label: string
          owner: string | null
          startWeek: number | null
          endWeek: number | null
          riskFlag: number
          position: number
        }>
      }
      const rowsBySection = new Map<string, typeof snapshot.rows>()
      for (const r of snapshot.rows) {
        const key = r.sectionId ?? '__unsectioned__'
        const arr = rowsBySection.get(key) ?? []
        arr.push(r)
        rowsBySection.set(key, arr)
      }
      const sections = snapshot.sections.map(s => ({
        ...s,
        rows: s.type === 'gantt' ? (rowsBySection.get(s.id) ?? []) : [],
      }))
      return NextResponse.json({
        schedule: { ...snapshot.schedule, status: scheduleRow.status, orgName: scheduleRow.orgName },
        sections,
        rows: snapshot.rows,
        analyticsResourceId: scheduleRow.id,
      })
    } catch {
      // Corrupt snapshot — fall through to live read.
    }
  }

  // Live fallback (no snapshot yet).
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
        themeMode: schema.scheduleSections.themeMode,
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

  const { id: internalId, publishedSnapshot: _ps, ...safeSchedule } = scheduleRow
  void _ps
  return NextResponse.json({
    schedule: safeSchedule,
    sections,
    rows: allRows,
    analyticsResourceId: internalId,
  })
}
