import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/schedules ──────────────────────────────────────────
// List project schedules. Filterable by orgId / dealId / status.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterDealId = url.searchParams.get('dealId')
  const filterStatus = url.searchParams.get('status')

  const database = await db() as unknown as D1

  const conditions = []
  if (filterOrgId) conditions.push(eq(schema.projectSchedules.orgId, filterOrgId))
  if (filterDealId) conditions.push(eq(schema.projectSchedules.dealId, filterDealId))
  if (filterStatus) conditions.push(eq(schema.projectSchedules.status, filterStatus))

  const items = await database
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
      status: schema.projectSchedules.status,
      publicShareToken: schema.projectSchedules.publicShareToken,
      createdAt: schema.projectSchedules.createdAt,
      updatedAt: schema.projectSchedules.updatedAt,
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
    })
    .from(schema.projectSchedules)
    .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.projectSchedules.dealId, schema.deals.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.projectSchedules.updatedAt))

  return NextResponse.json({ items })
}

// ── POST /api/admin/schedules ──────────────────────────────────────────
// Create a new schedule. Body accepts top-level metadata and an optional
// `rows` array for seeding from a template.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title?: string
    subtitle?: string
    orgId?: string | null
    dealId?: string | null
    preparedFor?: string
    preparedBy?: string
    effectiveDate?: string
    targetLaunchDate?: string
    numberOfWeeks?: number
    overviewHtml?: string
    rows?: Array<{
      rowType: 'section_header' | 'task' | 'gate' | 'critical_gate'
      label: string
      owner?: 'tahi' | 'client' | 'joint' | 'tahi_parallel' | null
      startWeek?: number | null
      endWeek?: number | null
      riskFlag?: boolean
    }>
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.projectSchedules).values({
    id,
    orgId: body.orgId ?? null,
    dealId: body.dealId ?? null,
    title: body.title.trim(),
    subtitle: body.subtitle?.trim() ?? null,
    preparedFor: body.preparedFor?.trim() ?? null,
    preparedBy: body.preparedBy?.trim() ?? null,
    effectiveDate: body.effectiveDate ?? null,
    targetLaunchDate: body.targetLaunchDate ?? null,
    numberOfWeeks: Math.max(1, Math.min(52, body.numberOfWeeks ?? 12)),
    overviewHtml: body.overviewHtml ?? null,
    status: 'draft',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Seed rows if provided (e.g. from a template). Chunked to stay under
  // D1's per-statement bind-variable cap (100 vars per query). Each row
  // takes 11 placeholders, so 9 rows per chunk = 99 vars (safe).
  if (body.rows?.length) {
    const seeded = body.rows.map((r, idx) => ({
      id: crypto.randomUUID(),
      scheduleId: id,
      rowType: r.rowType,
      label: r.label.trim(),
      owner: r.owner ?? null,
      startWeek: r.startWeek ?? null,
      endWeek: r.endWeek ?? null,
      riskFlag: r.riskFlag ? 1 : 0,
      position: idx,
      createdAt: now,
      updatedAt: now,
    }))
    const CHUNK = 9
    for (let i = 0; i < seeded.length; i += CHUNK) {
      const slice = seeded.slice(i, i + CHUNK)
      await database.insert(schema.scheduleRows).values(slice)
    }
  }

  return NextResponse.json({ id }, { status: 201 })
}
