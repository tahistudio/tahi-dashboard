import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

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

  return NextResponse.json({
    deal,
    contacts,
    activities: dealActivities,
    stages,
  })
}

// PATCH /api/admin/deals/[id]
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
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
    expectedCloseDate?: string | null
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.stageId !== undefined) updates.stageId = body.stageId
  if (body.value !== undefined) {
    updates.value = body.value
    updates.valueNzd = body.value // TODO: convert via exchange rates
  }
  if (body.currency !== undefined) updates.currency = body.currency
  if (body.ownerId !== undefined) updates.ownerId = body.ownerId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.closedAt !== undefined) updates.closedAt = body.closedAt
  if (body.closeReason !== undefined) updates.closeReason = body.closeReason
  if (body.source !== undefined) updates.source = body.source
  if (body.estimatedHoursPerWeek !== undefined) updates.estimatedHoursPerWeek = body.estimatedHoursPerWeek
  if (body.expectedCloseDate !== undefined) updates.expectedCloseDate = body.expectedCloseDate

  await database
    .update(schema.deals)
    .set(updates)
    .where(eq(schema.deals.id, id))

  return NextResponse.json({ ok: true })
}
