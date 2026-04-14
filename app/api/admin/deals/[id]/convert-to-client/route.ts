import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// POST /api/admin/deals/[id]/convert-to-client
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // Determine plan type from engagement type
  let planType = 'none'
  if (deal.engagementType === 'retainer') {
    planType = 'maintain'
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

  for (const col of defaultColumns) {
    await database.insert(schema.kanbanColumns).values({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      label: col.label,
      statusValue: col.statusValue,
      position: col.position,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  // If retainer plan, provision a subscription and tracks
  if (planType === 'maintain') {
    const subscriptionId = crypto.randomUUID()
    await database.insert(schema.subscriptions).values({
      id: subscriptionId,
      orgId: newOrgId,
      planType: 'maintain',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(schema.tracks).values({
      id: crypto.randomUUID(),
      subscriptionId,
      type: 'small',
      isPriorityTrack: false,
      currentRequestId: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Link the deal to the new org
  await database
    .update(schema.deals)
    .set({ orgId: newOrgId, updatedAt: now })
    .where(eq(schema.deals.id, id))

  return NextResponse.json({
    success: true,
    orgId: newOrgId,
    orgName: orgName,
    created: true,
  })
}
