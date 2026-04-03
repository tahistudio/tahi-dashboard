import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

// ── GET /api/admin/contacts/[id] ──────────────────────────────────────────
// Returns a single contact with org info, recent activities, and linked deals.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
  }

  const database = await db()

  // Fetch contact with org info
  const contactRows = await database
    .select({
      id: schema.contacts.id,
      orgId: schema.contacts.orgId,
      name: schema.contacts.name,
      email: schema.contacts.email,
      role: schema.contacts.role,
      clerkUserId: schema.contacts.clerkUserId,
      isPrimary: schema.contacts.isPrimary,
      lastLoginAt: schema.contacts.lastLoginAt,
      createdAt: schema.contacts.createdAt,
      updatedAt: schema.contacts.updatedAt,
      orgName: schema.organisations.name,
      orgStatus: schema.organisations.status,
      orgPlanType: schema.organisations.planType,
      orgWebsite: schema.organisations.website,
      orgLogoUrl: schema.organisations.logoUrl,
    })
    .from(schema.contacts)
    .leftJoin(schema.organisations, eq(schema.contacts.orgId, schema.organisations.id))
    .where(eq(schema.contacts.id, id))
    .limit(1)

  if (contactRows.length === 0) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const contact = contactRows[0]

  // Fetch linked deals via dealContacts junction
  const linkedDeals = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      value: schema.deals.value,
      valueNzd: schema.deals.valueNzd,
      currency: schema.deals.currency,
      closedAt: schema.deals.closedAt,
      createdAt: schema.deals.createdAt,
      stageId: schema.deals.stageId,
      stageName: schema.pipelineStages.name,
      stageSlug: schema.pipelineStages.slug,
      contactRole: schema.dealContacts.role,
    })
    .from(schema.dealContacts)
    .innerJoin(schema.deals, eq(schema.dealContacts.dealId, schema.deals.id))
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(eq(schema.dealContacts.contactId, id))
    .orderBy(desc(schema.deals.createdAt))

  // Fetch recent activities for this contact
  const recentActivities = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      dealId: schema.activities.dealId,
      scheduledAt: schema.activities.scheduledAt,
      completedAt: schema.activities.completedAt,
      durationMinutes: schema.activities.durationMinutes,
      outcome: schema.activities.outcome,
      createdAt: schema.activities.createdAt,
    })
    .from(schema.activities)
    .where(eq(schema.activities.contactId, id))
    .orderBy(desc(schema.activities.createdAt))
    .limit(20)

  // Fetch recent messages authored by this contact
  const recentMessages = await database
    .select({
      id: schema.messages.id,
      body: schema.messages.body,
      requestId: schema.messages.requestId,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.authorId, id),
        eq(schema.messages.authorType, 'contact'),
      )
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(20)

  return NextResponse.json({
    contact: {
      ...contact,
      org: {
        id: contact.orgId,
        name: contact.orgName,
        status: contact.orgStatus,
        planType: contact.orgPlanType,
        website: contact.orgWebsite,
        logoUrl: contact.orgLogoUrl,
      },
    },
    deals: linkedDeals,
    activities: recentActivities,
    messages: recentMessages,
  })
}

// ── PATCH /api/admin/contacts/[id] ────────────────────────────────────────
// Update contact fields.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
  }

  const body = await req.json() as {
    name?: string
    email?: string
    role?: string | null
    isPrimary?: boolean
  }

  // Validate at least one field is being updated
  const allowedFields = ['name', 'email', 'role', 'isPrimary'] as const
  const hasUpdate = allowedFields.some((f) => f in body)
  if (!hasUpdate) {
    return NextResponse.json(
      { error: 'At least one field (name, email, role, isPrimary) is required' },
      { status: 400 }
    )
  }

  // Validate name if provided
  if ('name' in body && (!body.name || !body.name.trim())) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }

  // Validate email if provided
  if ('email' in body && (!body.email || !body.email.trim())) {
    return NextResponse.json({ error: 'Email cannot be empty' }, { status: 400 })
  }

  const database = await db()

  // Verify contact exists
  const existing = await database
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, id))
    .limit(1)

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if ('name' in body && body.name) updateData.name = body.name.trim()
  if ('email' in body && body.email) updateData.email = body.email.trim().toLowerCase()
  if ('role' in body) updateData.role = body.role ?? null
  if ('isPrimary' in body) updateData.isPrimary = body.isPrimary

  await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .update(schema.contacts)
    .set(updateData)
    .where(eq(schema.contacts.id, id))

  return NextResponse.json({ success: true })
}
