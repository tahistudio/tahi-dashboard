import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { convertToNzd } from '@/lib/currency'
import { logActivity, formatMoney } from '@/lib/deal-activity'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/deals
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const stageId = url.searchParams.get('stageId')
  const ownerId = url.searchParams.get('ownerId')
  const source = url.searchParams.get('source')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const database = await db() as unknown as D1

  // Access scoping
  const scopedOrgIds = await resolveAccessScoping(database, userId)

  const conditions = []

  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ items: [], page, limit })
    }
    conditions.push(inArray(schema.deals.orgId, scopedOrgIds))
  }
  // Exclude archived (soft-deleted) deals
  conditions.push(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  if (filterOrgId) conditions.push(eq(schema.deals.orgId, filterOrgId))
  if (stageId) conditions.push(eq(schema.deals.stageId, stageId))
  if (ownerId) conditions.push(eq(schema.deals.ownerId, ownerId))
  if (source) conditions.push(eq(schema.deals.source, source))

  const items = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      orgId: schema.deals.orgId,
      stageId: schema.deals.stageId,
      ownerId: schema.deals.ownerId,
      value: schema.deals.value,
      currency: schema.deals.currency,
      valueNzd: schema.deals.valueNzd,
      source: schema.deals.source,
      estimatedHoursPerWeek: schema.deals.estimatedHoursPerWeek,
      autoNudgesDisabled: schema.deals.autoNudgesDisabled,
      expectedCloseDate: schema.deals.expectedCloseDate,
      closedAt: schema.deals.closedAt,
      closeReason: schema.deals.closeReason,
      notes: schema.deals.notes,
      createdAt: schema.deals.createdAt,
      updatedAt: schema.deals.updatedAt,
      orgName: schema.organisations.name,
      stageName: schema.pipelineStages.name,
      stageColour: schema.pipelineStages.colour,
      stageProbability: schema.pipelineStages.probability,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
      stageIsClosedLost: schema.pipelineStages.isClosedLost,
      ownerName: schema.teamMembers.name,
      ownerAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.deals)
    .leftJoin(schema.organisations, eq(schema.deals.orgId, schema.organisations.id))
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .leftJoin(schema.teamMembers, eq(schema.deals.ownerId, schema.teamMembers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.deals.updatedAt))
    .limit(limit)
    .offset(offset)

  // Fetch value_min/value_max via raw SQL. These columns were added in
  // migration 0017 and are not declared in the Drizzle schema until the
  // migration has run everywhere (Decision #039 lesson #1).
  type RangeRow = { id: string; value_min: number | null; value_max: number | null; value_min_nzd: number | null; value_max_nzd: number | null }
  let rangeMap: Record<string, { valueMin: number | null; valueMax: number | null; valueMinNzd: number | null; valueMaxNzd: number | null }> = {}
  const allDealIds = items.map(d => d.id)
  if (allDealIds.length > 0) {
    try {
      // UUIDs from our own DB — safe to interpolate. Still validate format.
      const safeIds = allDealIds.filter(id => /^[a-f0-9-]{36}$/i.test(id))
      if (safeIds.length > 0) {
        const list = safeIds.map(id => `'${id}'`).join(',')
        const res = await database.all(sql.raw(
          `SELECT id, value_min, value_max, value_min_nzd, value_max_nzd FROM deals WHERE id IN (${list})`,
        )) as unknown as RangeRow[] | { results?: RangeRow[] }
        const rows: RangeRow[] = Array.isArray(res) ? res : (res?.results ?? [])
        rangeMap = Object.fromEntries(rows.map(r => [r.id, {
          valueMin: r.value_min,
          valueMax: r.value_max,
          valueMinNzd: r.value_min_nzd,
          valueMaxNzd: r.value_max_nzd,
        }]))
      }
    } catch {
      // Migration 0017 not yet applied — skip range data.
      rangeMap = {}
    }
  }

  // Get contact counts per deal
  let contactCounts: Record<string, number> = {}
  if (allDealIds.length > 0) {
    const counts = await database
      .select({
        dealId: schema.dealContacts.dealId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.dealContacts)
      .where(inArray(schema.dealContacts.dealId, allDealIds))
      .groupBy(schema.dealContacts.dealId)

    contactCounts = Object.fromEntries(counts.map(c => [c.dealId, c.count]))
  }

  const enriched = items.map(item => {
    const range = rangeMap[item.id]
    return {
      ...item,
      valueMin: range?.valueMin ?? null,
      valueMax: range?.valueMax ?? null,
      valueMinNzd: range?.valueMinNzd ?? null,
      valueMaxNzd: range?.valueMaxNzd ?? null,
      contactCount: contactCounts[item.id] ?? 0,
    }
  })

  return NextResponse.json({ items: enriched, page, limit })
}

// POST /api/admin/deals
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    title?: string
    orgId?: string
    stageId?: string
    ownerId?: string
    value?: number
    valueMin?: number | null
    valueMax?: number | null
    currency?: string
    source?: string
    estimatedHoursPerWeek?: number
    expectedCloseDate?: string
    notes?: string
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.stageId) {
    return NextResponse.json({ error: 'stageId is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Range handling: if both min and max supplied, compute midpoint as
  // the primary value. Otherwise use the supplied single value.
  const hasRange = body.valueMin != null && body.valueMax != null && body.valueMin !== body.valueMax
  const valueMin = hasRange ? Math.min(body.valueMin!, body.valueMax!) : null
  const valueMax = hasRange ? Math.max(body.valueMin!, body.valueMax!) : null
  const midpoint = hasRange ? Math.round((valueMin! + valueMax!) / 2) : null
  const dealValue = midpoint ?? body.value ?? 0
  const dealCurrency = body.currency ?? 'NZD'

  // Convert to NZD using exchange rates
  async function toNzd(amount: number): Promise<number> {
    if (amount === 0 || dealCurrency === 'NZD') return amount
    const rates = await database
      .select({ currency: schema.exchangeRates.currency, rateToUsd: schema.exchangeRates.rateToUsd })
      .from(schema.exchangeRates)
    if (rates.length === 0) return amount
    return Math.round(convertToNzd(amount, dealCurrency, rates))
  }

  const valueNzd = await toNzd(dealValue)
  const valueMinNzd = valueMin != null ? await toNzd(valueMin) : null
  const valueMaxNzd = valueMax != null ? await toNzd(valueMax) : null

  await database.insert(schema.deals).values({
    id,
    title: body.title.trim(),
    orgId: body.orgId ?? null,
    stageId: body.stageId,
    ownerId: body.ownerId ?? null,
    value: dealValue,
    currency: dealCurrency,
    valueNzd,
    source: body.source ?? null,
    estimatedHoursPerWeek: body.estimatedHoursPerWeek ?? 0,
    expectedCloseDate: body.expectedCloseDate ?? null,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  })

  // Write the range columns via raw SQL (not in Drizzle schema yet)
  if (hasRange) {
    try {
      await database.run(sql`
        UPDATE deals
        SET value_min = ${valueMin},
            value_max = ${valueMax},
            value_min_nzd = ${valueMinNzd},
            value_max_nzd = ${valueMaxNzd}
        WHERE id = ${id}
      `)
    } catch (err) {
      // Migration 0017 not applied — log and continue.
      console.warn('[deals POST] range columns not yet available:', err instanceof Error ? err.message : err)
    }
  }

  // Fetch stage name for activity log
  const [stage] = await database
    .select({ name: schema.pipelineStages.name })
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.id, body.stageId))
    .limit(1)

  const valueLabel = hasRange
    ? `${formatMoney(valueMin!, dealCurrency)}\u2013${formatMoney(valueMax!, dealCurrency)}`
    : formatMoney(dealValue, dealCurrency)

  await logActivity(database, {
    dealId: id,
    orgId: body.orgId ?? null,
    type: 'deal_created',
    title: `Deal created in ${stage?.name ?? 'pipeline'}${dealValue > 0 ? ` \u00b7 ${valueLabel}` : ''}`,
    description: body.source ? `Source: ${body.source}` : null,
    createdById: userId,
    metadata: {
      initial: {
        stageId: body.stageId,
        value: dealValue,
        valueMin,
        valueMax,
        currency: dealCurrency,
        source: body.source ?? null,
        ownerId: body.ownerId ?? null,
        orgId: body.orgId ?? null,
        expectedCloseDate: body.expectedCloseDate ?? null,
      },
    },
  })

  return NextResponse.json({ id }, { status: 201 })
}
