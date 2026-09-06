import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, desc, and, ne } from 'drizzle-orm'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireManagePermissions } from '@/lib/require-permission'
import { logAudit } from '@/lib/audit'
import {
  countContactReferences,
  getContactForAdmin,
  isOnlyPrimary,
  listSiblingContacts,
  normaliseEmail,
  repointContactReferences,
} from '@/lib/contact-references'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Params = { params: Promise<{ id: string }> }

const PORTAL_ROLES = new Set(['admin', 'member'])
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── GET /api/admin/contacts/[id] ──────────────────────────────────────────
// Returns a single contact with org info, recent activities, and linked deals.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'clients')
  if (featureDenied) return featureDenied

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
      phone: schema.contacts.phone,
      role: schema.contacts.role,
      portalRole: schema.contacts.portalRole,
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

  // A contact is client data (CLAUDE.md rule 11): a scoped team member only
  // reads the people at the clients they can see.
  const denied = await requireAccessToOrg(database as D1, userId, contact.orgId)
  if (denied) return denied

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
// Edit a contact: name, email, phone, role (job title), isPrimary, portalRole.
//
// The email of a contact that signs in is refused: clerk_user_id is how a
// portal session resolves to this row, and the address Clerk holds is the
// one that was verified. Rewriting it here would leave the row describing a
// mailbox the login does not own. Change it in Clerk, or unlink first.
//
// isPrimary is a single flag per organisation (the invoices and the invite
// go to one address), so setting it demotes whoever held it. A portal role
// change is an access change, so it takes the permissions gate and writes
// the same audit row the permissions surface does.
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  const { orgId, userId } = auth
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'clients')
  if (featureDenied) return featureDenied

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
  }

  const body = await req.json() as {
    name?: unknown
    email?: unknown
    phone?: unknown
    role?: unknown
    isPrimary?: unknown
    portalRole?: unknown
  }

  const allowedFields = ['name', 'email', 'phone', 'role', 'isPrimary', 'portalRole'] as const
  if (!allowedFields.some((f) => f in body)) {
    return NextResponse.json(
      { error: 'At least one field (name, email, phone, role, isPrimary, portalRole) is required' },
      { status: 400 }
    )
  }

  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }
  if ('email' in body) {
    if (typeof body.email !== 'string' || !body.email.trim()) {
      return NextResponse.json({ error: 'Email cannot be empty' }, { status: 400 })
    }
    if (!EMAIL_SHAPE.test(body.email.trim())) {
      return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 })
    }
  }
  if ('phone' in body && body.phone !== null && typeof body.phone !== 'string') {
    return NextResponse.json({ error: 'phone must be a string or null' }, { status: 400 })
  }
  if ('role' in body && body.role !== null && typeof body.role !== 'string') {
    return NextResponse.json({ error: 'role must be a string or null' }, { status: 400 })
  }
  if ('isPrimary' in body && typeof body.isPrimary !== 'boolean') {
    return NextResponse.json({ error: 'isPrimary must be a boolean' }, { status: 400 })
  }
  if ('portalRole' in body && (typeof body.portalRole !== 'string' || !PORTAL_ROLES.has(body.portalRole))) {
    return NextResponse.json({ error: 'portalRole must be admin or member' }, { status: 400 })
  }

  const drizzle = (await db()) as D1
  const contact = await getContactForAdmin(drizzle, id)
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, contact.orgId)
  if (denied) return denied

  const changes: Record<string, { before: unknown; after: unknown }> = {}
  const updateData: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (name !== contact.name) { updateData.name = name; changes.name = { before: contact.name, after: name } }
  }
  if (typeof body.email === 'string') {
    const email = normaliseEmail(body.email)
    if (email !== normaliseEmail(contact.email)) {
      if (contact.clerkUserId) {
        return NextResponse.json({
          error: `${contact.name} signs in to the portal as ${contact.email}. That login is the truth: change the address in Clerk, or unlink them first.`,
          code: 'clerk_linked',
        }, { status: 409 })
      }
      updateData.email = email
      changes.email = { before: contact.email, after: email }
    }
  }
  if ('phone' in body) {
    const phone = typeof body.phone === 'string' ? (body.phone.trim() || null) : null
    if (phone !== (contact.phone ?? null)) { updateData.phone = phone; changes.phone = { before: contact.phone, after: phone } }
  }
  if ('role' in body) {
    const role = typeof body.role === 'string' ? (body.role.trim() || null) : null
    if (role !== (contact.role ?? null)) { updateData.role = role; changes.role = { before: contact.role, after: role } }
  }
  if (typeof body.isPrimary === 'boolean' && body.isPrimary !== Boolean(contact.isPrimary)) {
    updateData.isPrimary = body.isPrimary
    changes.isPrimary = { before: Boolean(contact.isPrimary), after: body.isPrimary }
  }
  const portalRole = typeof body.portalRole === 'string' ? body.portalRole : null
  const portalRoleChanged = portalRole !== null && portalRole !== contact.portalRole
  if (portalRoleChanged) {
    const { denied: cannotManage } = await requireManagePermissions(drizzle, auth)
    if (cannotManage) return cannotManage
    updateData.portalRole = portalRole
    changes.portalRole = { before: contact.portalRole, after: portalRole }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true, changed: [] })
  }

  const now = new Date().toISOString()

  if (updateData.isPrimary === true) {
    await drizzle
      .update(schema.contacts)
      .set({ isPrimary: false, updatedAt: now })
      .where(and(eq(schema.contacts.orgId, contact.orgId), ne(schema.contacts.id, id)))
  }

  await drizzle
    .update(schema.contacts)
    .set({ ...updateData, updatedAt: now })
    .where(eq(schema.contacts.id, id))

  await logAudit(drizzle as unknown as DB, {
    action: 'contact.updated',
    userId,
    entityType: 'contact',
    entityId: id,
    metadata: { orgId: contact.orgId, changes },
  })
  if (portalRoleChanged) {
    await logAudit(drizzle as unknown as DB, {
      action: 'permission.portal_role_changed',
      userId,
      entityType: 'contact',
      entityId: id,
      metadata: {
        before: { portalRole: contact.portalRole },
        after: { portalRole },
      },
    })
  }

  return NextResponse.json({ success: true, changed: Object.keys(changes) })
}

// ── DELETE /api/admin/contacts/[id] ───────────────────────────────────────
// Body (optional): { reassignTo?: contactId }
//
// Refused, with the reason, when the contact:
//   - signs in (clerk_user_id set). A login is never deleted from here.
//   - is the only primary at an organisation that still has other people,
//     and nobody is named to take everything over. Make someone else primary
//     first, or reassign.
//   - is referenced anywhere (see lib/contact-references.ts) and nobody is
//     named to take the references over.
// With reassignTo (another contact at the same organisation) every reference
// is re-pointed to them first, the primary flag moves with it, and the row is
// deleted last so a failure part way never leaves a dangling id.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'clients')
  if (featureDenied) return featureDenied

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
  }

  let body: { reassignTo?: unknown } = {}
  try {
    body = await req.json() as { reassignTo?: unknown }
  } catch {
    body = {}
  }
  const reassignTo = typeof body.reassignTo === 'string' && body.reassignTo.trim() ? body.reassignTo.trim() : null
  if (reassignTo === id) {
    return NextResponse.json({ error: 'A contact cannot be reassigned to itself' }, { status: 400 })
  }

  const drizzle = (await db()) as D1
  const contact = await getContactForAdmin(drizzle, id)
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, contact.orgId)
  if (denied) return denied

  if (contact.clerkUserId) {
    return NextResponse.json({
      error: `${contact.name} signs in to the portal; a contact with a login cannot be deleted. Unlink them in Clerk first.`,
      code: 'clerk_linked',
    }, { status: 409 })
  }

  const siblings = await listSiblingContacts(drizzle, contact)
  const target = reassignTo ? siblings.find(s => s.id === reassignTo) ?? null : null
  if (reassignTo && !target) {
    return NextResponse.json({ error: 'reassignTo must name another contact at the same organisation' }, { status: 400 })
  }

  const onlyPrimary = isOnlyPrimary(contact, siblings)
  if (onlyPrimary && !target) {
    return NextResponse.json({
      error: `${contact.name} is the only primary contact here; make someone else primary first.`,
      code: 'only_primary',
    }, { status: 409 })
  }

  const references = await countContactReferences(drizzle, id)
  if (references.total > 0 && !target) {
    return NextResponse.json({
      error: `${contact.name} is referenced by ${references.summary}; reassign them to another contact first.`,
      code: 'referenced',
      references: references.counts,
      total: references.total,
    }, { status: 409 })
  }

  const now = new Date().toISOString()
  if (target) {
    if (references.total > 0) {
      await repointContactReferences(drizzle, id, target.id)
    }
    if (contact.isPrimary && !target.isPrimary) {
      await drizzle
        .update(schema.contacts)
        .set({ isPrimary: true, updatedAt: now })
        .where(eq(schema.contacts.id, target.id))
    }
  }

  await drizzle.delete(schema.contacts).where(eq(schema.contacts.id, id))

  await logAudit(drizzle as unknown as DB, {
    action: 'contact.deleted',
    userId,
    entityType: 'contact',
    entityId: id,
    metadata: {
      orgId: contact.orgId,
      name: contact.name,
      email: contact.email,
      wasPrimary: Boolean(contact.isPrimary),
      reassignedTo: target ? { id: target.id, name: target.name, email: target.email } : null,
      moved: target ? Object.fromEntries(references.counts.filter(c => c.count > 0).map(c => [c.key, c.count])) : {},
      primaryMovedTo: target && contact.isPrimary && !target.isPrimary ? target.id : null,
    },
  })

  return NextResponse.json({
    success: true,
    reassignedTo: target?.id ?? null,
    moved: target ? references.total : 0,
  })
}
