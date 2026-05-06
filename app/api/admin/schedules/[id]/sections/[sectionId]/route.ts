import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string; sectionId: string }> }

// ── PATCH /api/admin/schedules/[id]/sections/[sectionId] ────────────────
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId, sectionId } = await ctx.params
  const body = await req.json() as {
    type?: 'overview' | 'gantt' | 'risk_register' | 'raci_matrix' | 'text'
    title?: string | null
    subtitle?: string | null
    startWeek?: number | null
    endWeek?: number | null
    data?: unknown
    position?: number
  }

  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.type !== undefined) updates.type = body.type
  if (body.title !== undefined) updates.title = body.title?.trim() ?? null
  if (body.subtitle !== undefined) updates.subtitle = body.subtitle?.trim() ?? null
  if (body.startWeek !== undefined) updates.startWeek = body.startWeek
  if (body.endWeek !== undefined) updates.endWeek = body.endWeek
  if (body.position !== undefined) updates.position = body.position
  if (body.data !== undefined) updates.data = body.data === null ? null : JSON.stringify(body.data)

  await database
    .update(schema.scheduleSections)
    .set(updates)
    .where(and(
      eq(schema.scheduleSections.id, sectionId),
      eq(schema.scheduleSections.scheduleId, scheduleId),
    ))

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/schedules/[id]/sections/[sectionId] ───────────────
// Cascades to schedule_rows that point at the section (FK is no-action,
// but we manually cascade since the Drizzle ref above doesn't enforce it
// for the section_id column). This avoids orphan rows lingering after a
// section is deleted.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId, sectionId } = await ctx.params
  const database = await db() as unknown as D1

  // Manual cascade — delete child rows first, then the section.
  await database
    .delete(schema.scheduleRows)
    .where(eq(schema.scheduleRows.sectionId, sectionId))
  await database
    .delete(schema.scheduleSections)
    .where(and(
      eq(schema.scheduleSections.id, sectionId),
      eq(schema.scheduleSections.scheduleId, scheduleId),
    ))

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}
