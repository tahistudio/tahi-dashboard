import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { convertToNzd } from '@/lib/currency'

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

  // Get contact counts per deal
  const dealIds = items.map(d => d.id)
  let contactCounts: Record<string, number> = {}
  if (dealIds.length > 0) {
    const counts = await database
      .select({
        dealId: schema.dealContacts.dealId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.dealContacts)
      .where(inArray(schema.dealContacts.dealId, dealIds))
      .groupBy(schema.dealContacts.dealId)

    contactCounts = Object.fromEntries(counts.map(c => [c.dealId, c.count]))
  }

  const enriched = items.map(item => ({
    ...item,
    contactCount: contactCounts[item.id] ?? 0,
  }))

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

  const dealValue = body.value ?? 0
  const dealCurrency = body.currency ?? 'NZD'

  // Convert value to NZD using exchange rates
  let valueNzd = dealValue
  if (dealCurrency !== 'NZD' && dealValue > 0) {
    const rates = await database
      .select({ currency: schema.exchangeRates.currency, rateToUsd: schema.exchangeRates.rateToUsd })
      .from(schema.exchangeRates)
    if (rates.length > 0) {
      valueNzd = Math.round(convertToNzd(dealValue, dealCurrency, rates))
    }
  }

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

  return NextResponse.json({ id }, { status: 201 })
}
