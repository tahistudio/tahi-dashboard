import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { dispatchDomainEvent } from '@/lib/events'
import { denyIfDealOrgOutOfScope } from '../../_access'
import { PLAN_TYPE_ERROR, isRetainerPlanType, normalisePlanType } from '@/lib/plan-type'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// POST /api/admin/deals/[id]/convert-to-client
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'deals')
  if (featureDenied) return featureDenied

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  // Fetch the deal with its stage info
  const [deal] = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      orgId: schema.deals.orgId,
      engagementType: schema.deals.engagementType,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
    })
    .from(schema.deals)
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  const denied = await denyIfDealOrgOutOfScope({ userId, orgId }, deal.orgId)
  if (denied) return denied

  // If the deal already has an orgId, check if that org is active
  if (deal.orgId) {
    const [existingOrg] = await database
      .select({
        id: schema.organisations.id,
        name: schema.organisations.name,
        status: schema.organisations.status,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, deal.orgId))
      .limit(1)

    if (existingOrg && existingOrg.status === 'active') {
      return NextResponse.json({
        success: true,
        orgId: existingOrg.id,
        orgName: existingOrg.name,
        created: false,
      })
    }

    // If the org exists but is not active, activate it
    if (existingOrg) {
      const now = new Date().toISOString()
      await database
        .update(schema.organisations)
        .set({ status: 'active', updatedAt: now })
        .where(eq(schema.organisations.id, existingOrg.id))

      return NextResponse.json({
        success: true,
        orgId: existingOrg.id,
        orgName: existingOrg.name,
        created: false,
      })
    }
  }

  // No linked org (or linked org was deleted). Create a new organisation.
  // Try to get company name from the first linked contact, fallback to deal title
  const orgName = deal.title

  const dealContactRows = await database
    .select({
      contactId: schema.dealContacts.contactId,
      contactOrgId: schema.contacts.orgId,
    })
    .from(schema.dealContacts)
    .leftJoin(schema.contacts, eq(schema.dealContacts.contactId, schema.contacts.id))
    .where(eq(schema.dealContacts.dealId, id))
    .limit(1)

  // If a contact is linked to an existing org, use that org instead of creating a new one
  if (dealContactRows.length > 0 && dealContactRows[0].contactOrgId) {
    const [contactOrg] = await database
      .select({
        id: schema.organisations.id,
        name: schema.organisations.name,
        status: schema.organisations.status,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, dealContactRows[0].contactOrgId))
      .limit(1)

    if (contactOrg) {
      const now = new Date().toISOString()
      // Activate the org if not already active
      if (contactOrg.status !== 'active') {
        await database
          .update(schema.organisations)
          .set({ status: 'active', updatedAt: now })
          .where(eq(schema.organisations.id, contactOrg.id))
      }
      // Link the deal to this org
      await database
        .update(schema.deals)
        .set({ orgId: contactOrg.id, updatedAt: now })
        .where(eq(schema.deals.id, id))

      return NextResponse.json({
        success: true,
        orgId: contactOrg.id,
        orgName: contactOrg.name,
        created: false,
      })
    }
  }

  // The plan is whatever the caller names, and nothing otherwise. This used to
  // read a retainer deal as a Maintain plan and mint an active subscription
  // for it, so a won Scale retainer, or one still being negotiated, landed as
  // a Maintain client that was never billed. A deal carries no plan column
  // (only engagementType), so there is nothing to infer from safely.
  let body: { planType?: string | null } = {}
  try {
    body = await req.json() as { planType?: string | null }
  } catch {
    body = {}
  }
  const planType = normalisePlanType(body.planType)
  if (planType === undefined) {
    return NextResponse.json({ error: PLAN_TYPE_ERROR }, { status: 400 })
  }

  const now = new Date().toISOString()
  const newOrgId = crypto.randomUUID()

  await database
    .insert(schema.organisations)
    .values({
      id: newOrgId,
      name: orgName,
      status: 'active',
      planType,
      preferredCurrency: 'NZD',
      healthStatus: 'green',
      createdAt: now,
      updatedAt: now,
    })

  // Seed default kanban columns for the new client
  const defaultColumns = [
    { label: 'Submitted',     statusValue: 'submitted',     position: 0 },
    { label: 'In Review',     statusValue: 'in_review',     position: 1 },
    { label: 'In Progress',   statusValue: 'in_progress',   position: 2 },
    { label: 'Client Review', statusValue: 'client_review', position: 3 },
    { label: 'Delivered',     statusValue: 'delivered',      position: 4 },
    { label: 'Archived',      statusValue: 'archived',      position: 5 },
  ]

  await database.insert(schema.kanbanColumns).values(
    defaultColumns.map(col => ({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      label: col.label,
      statusValue: col.statusValue,
      position: col.position,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    }))
  )

  // An explicitly named retainer plan comes with its subscription and tracks,
  // the same shape POST /api/admin/clients provisions: Maintain is one small
  // track, Scale is one small and one large.
  if (isRetainerPlanType(planType)) {
    const subscriptionId = crypto.randomUUID()
    await database.insert(schema.subscriptions).values({
      id: subscriptionId,
      orgId: newOrgId,
      planType,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    const trackDefs: Array<{ type: 'small' | 'large' }> =
      planType === 'scale'
        ? [{ type: 'small' }, { type: 'large' }]
        : [{ type: 'small' }]

    for (const t of trackDefs) {
      await database.insert(schema.tracks).values({
        id: crypto.randomUUID(),
        subscriptionId,
        type: t.type,
        isPriorityTrack: false,
        currentRequestId: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // Link the deal to the new org
  await database
    .update(schema.deals)
    .set({ orgId: newOrgId, updatedAt: now })
    .where(eq(schema.deals.id, id))

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(database, {
    type: 'client_onboarded',
    entityId: newOrgId,
    entityType: 'organisation',
    orgId: newOrgId,
    data: {
      name: orgName,
      planType,
      source: 'deal_conversion',
      dealId: id,
    },
  })

  return NextResponse.json({
    success: true,
    orgId: newOrgId,
    orgName: orgName,
    created: true,
  })
}
