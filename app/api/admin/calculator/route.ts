import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { compute } from '@/lib/calculator/compute'
import type { CalculationInputs } from '@/lib/calculator/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/calculator
 *   ?dealId=...     filter to one deal
 *   ?orgId=...      filter to one org
 * Returns the most recent first. Active calc per deal is the one
 * surfaced in the deal detail; everything else is history.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const dealId = url.searchParams.get('dealId')
  const filterOrgId = url.searchParams.get('orgId')
  const database = await db() as unknown as D1
  const where = dealId
    ? eq(schema.projectCalculations.dealId, dealId)
    : filterOrgId
      ? eq(schema.projectCalculations.orgId, filterOrgId)
      : undefined
  const rows = where
    ? await database.select().from(schema.projectCalculations).where(where).orderBy(desc(schema.projectCalculations.updatedAt))
    : await database.select().from(schema.projectCalculations).orderBy(desc(schema.projectCalculations.updatedAt))
  return NextResponse.json({ calculations: rows })
}

/**
 * POST /api/admin/calculator
 * Body: { name, dealId?, orgId?, inputs: CalculationInputs }
 * Computes outputs server-side using current pipeline + capacity
 * snapshot, persists both inputs + outputs.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    name?: string
    dealId?: string | null
    orgId?: string | null
    inputs?: CalculationInputs
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!body.inputs) return NextResponse.json({ error: 'inputs are required' }, { status: 400 })

  const database = await db() as unknown as D1

  // ── Pull live context for the math ───────────────────────────
  // Booked hours in the calc window = sum of scheduleRows where the
  // row's week range overlaps [startDate, startDate + durationWeeks].
  // Approximate: count every active schedule's row hours pro-rata
  // by overlap weeks. Cheap enough to do per-call.
  // The two estimators are independent reads (one hits scheduleRows, the
  // other deals) and neither uses the other's result, so resolve them
  // concurrently rather than back to back.
  const [bookedHoursInWindow, similarDeals] = await Promise.all([
    estimateBookedHours(database, body.inputs),
    fetchSimilarDeals(database),
  ])

  const outputs = compute(body.inputs, { bookedHoursInWindow, similarDeals })

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.projectCalculations).values({
    id,
    dealId: body.dealId ?? null,
    orgId: body.orgId ?? null,
    name: body.name.trim(),
    isActive: 1,
    inputs: JSON.stringify(body.inputs),
    outputs: JSON.stringify(outputs),
    linkedArtefactRef: null,
    createdById: userId ?? 'api-service',
    createdAt: now,
    updatedAt: now,
  })

  // If this calc is anchored to a deal, demote prior calcs on that
  // deal to inactive so the deal page surfaces the latest one first.
  if (body.dealId) {
    await database.update(schema.projectCalculations).set({
      isActive: 0,
      updatedAt: now,
    }).where(and(
      eq(schema.projectCalculations.dealId, body.dealId),
      sql`${schema.projectCalculations.id} != ${id}`,
    ))
  }

  return NextResponse.json({ id, inputs: body.inputs, outputs })
}

/**
 * Estimate hours booked between [startDate, startDate + durationWeeks)
 * across all active schedules. Each schedule_rows row contributes
 * (endWeek - startWeek + 1) * 8 hours (rough heuristic — 8h per
 * gantt-week for a row marked by the team). Section header rows are
 * skipped (rowType !== 'section').
 */
async function estimateBookedHours(
  database: D1,
  inputs: CalculationInputs,
): Promise<number> {
  // For now: sum across all rows of all schedules. Refining to a
  // per-week overlap requires joining with schedules.startDate which
  // schedules don't reliably store today. Iterate later.
  const rows = await database
    .select({
      rowType: schema.scheduleRows.rowType,
      startWeek: schema.scheduleRows.startWeek,
      endWeek: schema.scheduleRows.endWeek,
    })
    .from(schema.scheduleRows)
  let hours = 0
  for (const r of rows) {
    if (r.rowType === 'section') continue
    if (r.startWeek == null || r.endWeek == null) continue
    const weeks = Math.max(1, r.endWeek - r.startWeek + 1)
    hours += weeks * 8
  }
  // Voice of caution — only count a fraction since most schedules
  // span many months. The math wants "competing for THIS calc's
  // window" hours, and we don't know per-row dates yet.
  const calcWeeks = Math.max(1, inputs.timeline.durationWeeks)
  // Assume 1 in 4 booked hours falls inside the calc window on average.
  return Math.round(hours * (calcWeeks / 52) * 0.25)
}

async function fetchSimilarDeals(
  database: D1,
): Promise<Array<{ dealId: string; title: string; value: number; currency: string; closedAt: string | null }>> {
  // Heuristic: same currency, won status, last 24 months. Pull top 10
  // by value, return those within 50% of the calc's target ballpark.
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 24)
  const rows = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      value: schema.deals.value,
      upfrontValue: schema.deals.upfrontValue,
      monthlyValue: schema.deals.monthlyValue,
      currency: schema.deals.currency,
      closedAt: schema.deals.closedAt,
      stageId: schema.deals.stageId,
    })
    .from(schema.deals)
    .limit(50)
  // Filter heuristic: any deal with closedAt in the past 24 months
  // and a non-zero value or upfrontValue. Pipeline stages don't have
  // a "won" flag we can rely on, so the closedAt date is the cleanest
  // signal that the deal landed.
  const now = Date.now()
  const matches: Array<{ dealId: string; title: string; value: number; currency: string; closedAt: string | null }> = []
  for (const r of rows) {
    const v = r.value || (r.upfrontValue ?? 0) || ((r.monthlyValue ?? 0) * 12)
    if (!v || v <= 0) continue
    if (!r.closedAt) continue
    const closedTs = new Date(r.closedAt).getTime()
    if (closedTs < cutoff.getTime() || closedTs > now) continue
    matches.push({
      dealId: r.id,
      title: r.title,
      value: v,
      currency: r.currency ?? 'NZD',
      closedAt: r.closedAt,
    })
    if (matches.length >= 10) break
  }
  return matches
}

export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as {
    id?: string
    name?: string
    inputs?: CalculationInputs
    linkedArtefactRef?: string | null
    isActive?: 0 | 1
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name) updates.name = body.name.trim()
  if (body.linkedArtefactRef !== undefined) updates.linkedArtefactRef = body.linkedArtefactRef
  if (body.isActive !== undefined) updates.isActive = body.isActive
  if (body.inputs) {
    // Re-run math whenever inputs change. The two estimators are independent
    // reads, so resolve them concurrently.
    const [bookedHoursInWindow, similarDeals] = await Promise.all([
      estimateBookedHours(database, body.inputs),
      fetchSimilarDeals(database),
    ])
    const outputs = compute(body.inputs, { bookedHoursInWindow, similarDeals })
    updates.inputs = JSON.stringify(body.inputs)
    updates.outputs = JSON.stringify(outputs)
  }
  // Update and read back the full row in a single round-trip via RETURNING,
  // instead of an update followed by a separate SELECT.
  const [row] = await database.update(schema.projectCalculations).set(updates)
    .where(eq(schema.projectCalculations.id, body.id))
    .returning()
  return NextResponse.json({ calculation: row })
}

export async function DELETE(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const ids = url.searchParams.get('ids')?.split(',') ?? []
  const single = url.searchParams.get('id')
  const targets = single ? [single] : ids
  if (targets.length === 0) return NextResponse.json({ error: 'id or ids is required' }, { status: 400 })
  const database = await db() as unknown as D1
  await database.delete(schema.projectCalculations).where(inArray(schema.projectCalculations.id, targets))
  return NextResponse.json({ deleted: targets.length })
}
