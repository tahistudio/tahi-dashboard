import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import {
  computeRowStatus,
  computeEngagementStatus,
  type LinkedWorkItem,
} from '@/lib/delivery-status'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/schedules/[id]/delivery-status
// Returns live per-row delivery status + an engagement rollup, derived from the
// requests/tasks linked to each gantt row (scheduleRowId) vs the planned window.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: scheduleId } = await params
  const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [schedule] = await drizzle
    .select({ id: schema.projectSchedules.id, effectiveDate: schema.projectSchedules.effectiveDate })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, scheduleId))
    .limit(1)

  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  const rows = await drizzle
    .select({
      id: schema.scheduleRows.id,
      rowType: schema.scheduleRows.rowType,
      startWeek: schema.scheduleRows.startWeek,
      endWeek: schema.scheduleRows.endWeek,
      riskFlag: schema.scheduleRows.riskFlag,
    })
    .from(schema.scheduleRows)
    .where(eq(schema.scheduleRows.scheduleId, scheduleId))

  const rowIds = rows.map(r => r.id)

  const byRow = new Map<string, LinkedWorkItem[]>()
  const push = (rowId: string | null, item: LinkedWorkItem) => {
    if (!rowId) return
    const arr = byRow.get(rowId)
    if (arr) arr.push(item)
    else byRow.set(rowId, [item])
  }

  if (rowIds.length) {
    const [reqs, tsks] = await Promise.all([
      drizzle
        .select({
          id: schema.requests.id,
          scheduleRowId: schema.requests.scheduleRowId,
          status: schema.requests.status,
          dueDate: schema.requests.dueDate,
          scopeFlagged: schema.requests.scopeFlagged,
        })
        .from(schema.requests)
        .where(inArray(schema.requests.scheduleRowId, rowIds)),
      drizzle
        .select({
          id: schema.tasks.id,
          scheduleRowId: schema.tasks.scheduleRowId,
          status: schema.tasks.status,
          dueDate: schema.tasks.dueDate,
        })
        .from(schema.tasks)
        .where(inArray(schema.tasks.scheduleRowId, rowIds)),
    ])

    for (const r of reqs) {
      push(r.scheduleRowId, {
        kind: 'request', id: r.id, status: r.status,
        dueDate: r.dueDate, scopeFlagged: !!r.scopeFlagged,
      })
    }
    for (const t of tsks) {
      push(t.scheduleRowId, { kind: 'task', id: t.id, status: t.status, dueDate: t.dueDate })
    }
  }

  const now = new Date().toISOString()
  const rowStatuses = rows.map(r =>
    computeRowStatus(
      { id: r.id, rowType: r.rowType, startWeek: r.startWeek, endWeek: r.endWeek, riskFlag: r.riskFlag },
      byRow.get(r.id) ?? [],
      now,
      schedule.effectiveDate,
    ),
  )

  return NextResponse.json({
    rows: rowStatuses,
    engagement: computeEngagementStatus(rowStatuses),
  })
}
