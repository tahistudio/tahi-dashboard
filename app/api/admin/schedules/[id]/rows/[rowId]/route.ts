import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string; rowId: string }> }

// ── PATCH /api/admin/schedules/[id]/rows/[rowId] ───────────────────────
// Partial update of a row. Pass the fields you want to change.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId, rowId } = await ctx.params
  const body = await req.json() as {
    rowType?: 'section_header' | 'task' | 'gate' | 'critical_gate'
    label?: string
    owner?: 'tahi' | 'client' | 'joint' | 'tahi_parallel' | null
    startWeek?: number | null
    endWeek?: number | null
    riskFlag?: boolean
    position?: number
  }

  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.rowType !== undefined) updates.rowType = body.rowType
  if (body.label !== undefined) updates.label = body.label.trim()
  if (body.owner !== undefined) updates.owner = body.owner
  if (body.startWeek !== undefined) updates.startWeek = body.startWeek
  if (body.endWeek !== undefined) updates.endWeek = body.endWeek
  if (body.riskFlag !== undefined) updates.riskFlag = body.riskFlag ? 1 : 0
  if (body.position !== undefined) updates.position = body.position

  // Gate rows always have startWeek === endWeek. Auto-mirror if either was sent.
  // Re-fetch to know the row's current type if not changing it in this call.
  if (
    (body.rowType === 'gate' || body.rowType === 'critical_gate') ||
    body.startWeek !== undefined ||
    body.endWeek !== undefined
  ) {
    const [existing] = await database
      .select({ rowType: schema.scheduleRows.rowType, startWeek: schema.scheduleRows.startWeek, endWeek: schema.scheduleRows.endWeek })
      .from(schema.scheduleRows)
      .where(and(eq(schema.scheduleRows.id, rowId), eq(schema.scheduleRows.scheduleId, scheduleId)))
      .limit(1)
    const finalType = (body.rowType ?? existing?.rowType) as string | undefined
    if (finalType === 'gate' || finalType === 'critical_gate') {
      const sw = (updates.startWeek as number | null | undefined) ?? existing?.startWeek ?? null
      if (sw != null) updates.endWeek = sw
    }
  }

  await database
    .update(schema.scheduleRows)
    .set(updates)
    .where(and(eq(schema.scheduleRows.id, rowId), eq(schema.scheduleRows.scheduleId, scheduleId)))

  // Bump the parent schedule's updatedAt
  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/schedules/[id]/rows/[rowId] ──────────────────────
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId, rowId } = await ctx.params
  const database = await db() as unknown as D1

  await database
    .delete(schema.scheduleRows)
    .where(and(eq(schema.scheduleRows.id, rowId), eq(schema.scheduleRows.scheduleId, scheduleId)))

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}
