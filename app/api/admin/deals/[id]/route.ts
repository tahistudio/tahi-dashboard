import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, sql, and } from 'drizzle-orm'
import { convertToNzd } from '@/lib/currency'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/admin/deals/[id]
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  // Get deal with joins
  const [deal] = await database
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
      engagementType: schema.deals.engagementType,
      totalHours: schema.deals.totalHours,
      hoursPerMonth: schema.deals.hoursPerMonth,
      engagementStartDate: schema.deals.engagementStartDate,
      engagementEndDate: schema.deals.engagementEndDate,
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
      stagePosition: schema.pipelineStages.position,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
      stageIsClosedLost: schema.pipelineStages.isClosedLost,
      ownerName: schema.teamMembers.name,
      ownerAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.deals)
    .leftJoin(schema.organisations, eq(schema.deals.orgId, schema.organisations.id))
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .leftJoin(schema.teamMembers, eq(schema.deals.ownerId, schema.teamMembers.id))
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Get contacts for this deal
  const contacts = await database
    .select({
      id: schema.dealContacts.id,
      contactId: schema.dealContacts.contactId,
      role: schema.dealContacts.role,
      contactName: schema.contacts.name,
      contactEmail: schema.contacts.email,
      contactRole: schema.contacts.role,
    })
    .from(schema.dealContacts)
    .leftJoin(schema.contacts, eq(schema.dealContacts.contactId, schema.contacts.id))
    .where(eq(schema.dealContacts.dealId, id))

  // Get activities for this deal
  const dealActivities = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      createdById: schema.activities.createdById,
      scheduledAt: schema.activities.scheduledAt,
      completedAt: schema.activities.completedAt,
      durationMinutes: schema.activities.durationMinutes,
      outcome: schema.activities.outcome,
      createdAt: schema.activities.createdAt,
      createdByName: schema.teamMembers.name,
    })
    .from(schema.activities)
    .leftJoin(schema.teamMembers, eq(schema.activities.createdById, schema.teamMembers.id))
    .where(eq(schema.activities.dealId, id))
    .orderBy(desc(schema.activities.createdAt))

  // Get all pipeline stages for progress indicator
  const stages = await database
    .select({
      id: schema.pipelineStages.id,
      name: schema.pipelineStages.name,
      position: schema.pipelineStages.position,
      colour: schema.pipelineStages.colour,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.pipelineStages)
    .orderBy(schema.pipelineStages.position)

  // Compute LTV when deal is linked to an org
  let ltv = null
  if (deal.orgId) {
    const [invoiceTotal] = await database
      .select({ total: sql<number>`COALESCE(SUM(${schema.invoices.totalUsd}), 0)` })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, deal.orgId),
        eq(schema.invoices.status, 'paid'),
      ))

    const [wonDealTotal] = await database
      .select({
        total: sql<number>`COALESCE(SUM(${schema.deals.valueNzd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .where(and(
        eq(schema.deals.orgId, deal.orgId),
        eq(schema.pipelineStages.isClosedWon, 1),
      ))

    const [invoiceCount] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, deal.orgId),
        eq(schema.invoices.status, 'paid'),
      ))

    ltv = {
      totalPaidInvoices: invoiceTotal?.total ?? 0,
      totalWonDeals: wonDealTotal?.total ?? 0,
      wonDealCount: wonDealTotal?.count ?? 0,
      paidInvoiceCount: invoiceCount?.count ?? 0,
      total: (invoiceTotal?.total ?? 0) + (wonDealTotal?.total ?? 0),
    }
  }

  return NextResponse.json({
    deal,
    contacts,
    activities: dealActivities,
    stages,
    ltv,
  })
}

// PATCH /api/admin/deals/[id]
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    stageId?: string
    value?: number
    currency?: string
    ownerId?: string | null
    orgId?: string | null
    notes?: string | null
    closedAt?: string | null
    closeReason?: string | null
    source?: string | null
    estimatedHoursPerWeek?: number
    engagementType?: string | null
    totalHours?: number | null
    hoursPerMonth?: number | null
    engagementStartDate?: string | null
    engagementEndDate?: string | null
    expectedCloseDate?: string | null
    wonSource?: string | null
    lostReason?: string | null
    autoNudgesDisabled?: boolean
    status?: 'won' | 'lost'
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.stageId !== undefined) updates.stageId = body.stageId
  if (body.value !== undefined) updates.value = body.value
  if (body.currency !== undefined) updates.currency = body.currency

  // Re-compute valueNzd when value or currency changes
  if (body.value !== undefined || body.currency !== undefined) {
    // We need to know the final value and currency to convert.
    // If only one changed, fetch the current deal for the other field.
    let finalValue = body.value
    let finalCurrency = body.currency
    if (finalValue === undefined || finalCurrency === undefined) {
      const [existing] = await database
        .select({ value: schema.deals.value, currency: schema.deals.currency })
        .from(schema.deals)
        .where(eq(schema.deals.id, id))
        .limit(1)
      if (existing) {
        if (finalValue === undefined) finalValue = existing.value
        if (finalCurrency === undefined) finalCurrency = existing.currency
      }
    }
    const val = finalValue ?? 0
    const cur = finalCurrency ?? 'NZD'
    if (cur === 'NZD' || val === 0) {
      updates.valueNzd = val
    } else {
      const rates = await database
        .select({ currency: schema.exchangeRates.currency, rateToUsd: schema.exchangeRates.rateToUsd })
        .from(schema.exchangeRates)
      if (rates.length > 0) {
        updates.valueNzd = Math.round(convertToNzd(val, cur, rates))
      } else {
        updates.valueNzd = val
      }
    }
  }
  if (body.ownerId !== undefined) updates.ownerId = body.ownerId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.closedAt !== undefined) updates.closedAt = body.closedAt
  if (body.closeReason !== undefined) updates.closeReason = body.closeReason
  if (body.source !== undefined) updates.source = body.source
  if (body.estimatedHoursPerWeek !== undefined) updates.estimatedHoursPerWeek = body.estimatedHoursPerWeek
  if (body.engagementType !== undefined) updates.engagementType = body.engagementType
  if (body.totalHours !== undefined) updates.totalHours = body.totalHours
  if (body.hoursPerMonth !== undefined) updates.hoursPerMonth = body.hoursPerMonth
  if (body.engagementStartDate !== undefined) updates.engagementStartDate = body.engagementStartDate
  if (body.engagementEndDate !== undefined) updates.engagementEndDate = body.engagementEndDate
  if (body.expectedCloseDate !== undefined) updates.expectedCloseDate = body.expectedCloseDate
  if (body.wonSource !== undefined) updates.wonSource = body.wonSource
  if (body.lostReason !== undefined) updates.closeReason = body.lostReason
  if (body.autoNudgesDisabled !== undefined) updates.autoNudgesDisabled = body.autoNudgesDisabled ? 1 : 0

  // When status is explicitly set to won or lost, auto-set closedAt
  if (body.status === 'won' || body.status === 'lost') {
    updates.closedAt = now
  }

  // Stage transition logging (T353): when stageId changes, create an activity
  if (body.stageId !== undefined) {
    // Fetch the old deal stage and the new stage name for the activity description
    const [oldDeal] = await database
      .select({ stageId: schema.deals.stageId })
      .from(schema.deals)
      .where(eq(schema.deals.id, id))
      .limit(1)

    if (oldDeal && oldDeal.stageId !== body.stageId) {
      // Fetch both stage names
      const stages = await database
        .select({ id: schema.pipelineStages.id, name: schema.pipelineStages.name })
        .from(schema.pipelineStages)
        .where(
          eq(schema.pipelineStages.id, oldDeal.stageId)
        )

      const [newStage] = await database
        .select({ name: schema.pipelineStages.name })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.id, body.stageId))
        .limit(1)

      const oldStageName = stages[0]?.name ?? 'Unknown'
      const newStageName = newStage?.name ?? 'Unknown'

      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'stage_change',
        title: `Stage changed from ${oldStageName} to ${newStageName}`,
        dealId: id,
        createdById: userId ?? 'system',
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  await database
    .update(schema.deals)
    .set(updates)
    .where(eq(schema.deals.id, id))

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/deals/[id] -- Soft delete (archives the deal)
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Verify deal exists
  const [deal] = await database
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Soft delete: set closedAt and closeReason to 'archived'
  await database
    .update(schema.deals)
    .set({
      closedAt: now,
      closeReason: 'archived',
      updatedAt: now,
    })
    .where(eq(schema.deals.id, id))

  return NextResponse.json({ success: true })
}
