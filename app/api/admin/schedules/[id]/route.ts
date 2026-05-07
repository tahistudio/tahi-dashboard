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

  // Sectioned schedules (migration 0026): fetch sections + their rows in
  // one batched read, then nest the rows under each section. Rows without
  // a section_id (legacy data that somehow escaped backfill) ride on a
  // synthetic 'unsectioned' bucket so nothing disappears.
  const [sectionRows, allRows] = await Promise.all([
    database
      .select()
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, id))
      .orderBy(asc(schema.scheduleSections.position)),
    database
      .select()
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.scheduleId, id))
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
    // Only gantt-type sections need rows nested in. Other types carry
    // their content in `data` (parsed by the client).
    rows: s.type === 'gantt' ? (rowsBySection.get(s.id) ?? []) : [],
  }))

  return NextResponse.json({
    schedule: scheduleRow,
    sections,
    // Back-compat: legacy clients expect a flat `rows` array. Keep it
    // populated until we've migrated every consumer to read from sections.
    rows: allRows,
  })
}

// ── PATCH /api/admin/schedules/[id] ────────────────────────────────────
// Partial update of top-level fields. Row mutations live on /rows endpoints.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    subtitle?: string | null
    orgId?: string | null
    dealId?: string | null
    proposalId?: string | null
    preparedFor?: string | null
    preparedBy?: string | null
    effectiveDate?: string | null
    targetLaunchDate?: string | null
    numberOfWeeks?: number
    overviewHtml?: string | null
    status?: 'draft' | 'shared' | 'archived'
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now }

  // Read current dealId so we can log link/unlink activity if it changes.
  const [current] = await database
    .select({ dealId: schema.projectSchedules.dealId, title: schema.projectSchedules.title })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.subtitle !== undefined) updates.subtitle = body.subtitle?.trim() ?? null
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.dealId !== undefined) updates.dealId = body.dealId
  if (body.proposalId !== undefined) updates.proposalId = body.proposalId
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

  // Activity log on deal link/unlink — keeps the pipeline timeline complete.
  if (body.dealId !== undefined && current && body.dealId !== current.dealId) {
    const scheduleTitle = (body.title?.trim() ?? current.title ?? 'Schedule')
    const actor = userId ?? 'system'
    if (current.dealId) {
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'schedule_unlinked',
        title: `Schedule unlinked: ${scheduleTitle}`,
        description: null,
        dealId: current.dealId,
        createdById: actor,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (body.dealId) {
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'schedule_linked',
        title: `Schedule linked: ${scheduleTitle}`,
        description: null,
        dealId: body.dealId,
        createdById: actor,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

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
