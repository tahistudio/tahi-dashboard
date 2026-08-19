import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'
import { notifyTeamMember } from '@/lib/notifications'
import { dispatchDomainEvent } from '@/lib/events'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/portal/requests/[id] ────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Explicit client-safe projection. Internal-only columns (scopeFlagged,
  // scopeFlagReason, isInternal, queueOrder, assigneeId, checklists, tags,
  // scheduleRowId) are OMITTED entirely rather than blanked, so the payload
  // that reaches a paying client never carries the studio's private routing
  // and scope data. Scoped to the caller's own org and non-internal requests.
  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      description: schema.requests.description,
      status: schema.requests.status,
      priority: schema.requests.priority,
      estimatedHours: schema.requests.estimatedHours,
      startDate: schema.requests.startDate,
      dueDate: schema.requests.dueDate,
      revisionCount: schema.requests.revisionCount,
      maxRevisions: schema.requests.maxRevisions,
      requestNumber: schema.requests.requestNumber,
      size: schema.requests.size,
      parentRequestId: schema.requests.parentRequestId,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Resolve the caller's own contact row + their org display name so their own
  // messages read as theirs (name + org), and so own-message detection works
  // against the stored contact id (portal messages store authorId = contact.id,
  // not the Clerk user id).
  const [self] = userId
    ? await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.clerkUserId, userId))
        .limit(1)
    : [undefined]
  const selfContactId = self?.id ?? null

  const [org] = await drizzle
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  const orgName = org?.name ?? null

  // Messages: client only sees non-internal. Join the team member name (studio
  // authors) and the contact name (client authors) so each bubble is labelled
  // by a real person instead of a flat "Client".
  const msgRows = await drizzle
    .select({
      id: schema.messages.id,
      authorId: schema.messages.authorId,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      isInternal: schema.messages.isInternal,
      editedAt: schema.messages.editedAt,
      createdAt: schema.messages.createdAt,
      teamMemberName: schema.teamMembers.name,
      contactName: schema.contacts.name,
    })
    .from(schema.messages)
    .leftJoin(
      schema.teamMembers,
      and(
        eq(schema.messages.authorId, schema.teamMembers.id),
        eq(schema.messages.authorType, 'team_member'),
      ),
    )
    .leftJoin(
      schema.contacts,
      and(
        eq(schema.messages.authorId, schema.contacts.id),
        eq(schema.messages.authorType, 'contact'),
      ),
    )
    .where(and(
      eq(schema.messages.requestId, id),
      eq(schema.messages.isInternal, false),
    ))
    .orderBy(asc(schema.messages.createdAt))

  const messages = msgRows.map(m => {
    const isContact = m.authorType === 'contact'
    // Contact authors carry "Name (Org)"; studio authors keep teamMemberName
    // (RequestThread falls back to "Tahi Team" when null).
    const authorName = isContact
      ? (m.contactName
          ? (orgName ? `${m.contactName} (${orgName})` : m.contactName)
          : null)
      : null
    return {
      id: m.id,
      authorId: m.authorId,
      authorType: m.authorType,
      body: m.body,
      isInternal: m.isInternal,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      teamMemberName: m.teamMemberName,
      authorName,
      isOwn: isContact && selfContactId != null && m.authorId === selfContactId,
    }
  })

  return NextResponse.json({ request, messages })
}

// ── PATCH /api/portal/requests/[id] ──────────────────────────────────────────
// The ONLY client-writable transition on a portal request: approving a
// delivery. A client of the owning org may move a request from client_review
// to delivered ("Approve & close"). Every other field and every other status
// change stays studio-only; anything outside this whitelist is rejected.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const { id } = await params

  let body: { status?: string }
  try {
    body = await req.json() as { status?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Strict whitelist: the only accepted mutation is status -> delivered.
  if (body.status !== 'delivered') {
    return NextResponse.json({ error: 'Unsupported change' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Load the target scoped to the caller's own, non-internal request.
  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      status: schema.requests.status,
      assigneeId: schema.requests.assigneeId,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Only a delivery awaiting sign-off can be approved. Reject any other
  // starting state so a client can never fast-forward or reopen a request.
  if (request.status !== 'client_review') {
    return NextResponse.json({ error: 'Only a request in client review can be approved' }, { status: 400 })
  }

  const now = new Date().toISOString()
  await drizzle
    .update(schema.requests)
    .set({ status: 'delivered', deliveredAt: now, updatedAt: now })
    .where(eq(schema.requests.id, id))

  // Best-effort: tell the assignee the client approved, and fire the domain
  // event so automations/webhooks see the same status change the studio path
  // emits. Neither should block the approval response.
  try {
    if (request.assigneeId) {
      await notifyTeamMember(drizzle, request.assigneeId, {
        type: 'request_status_changed',
        title: `Client approved "${request.title}"`,
        body: 'The client approved this delivery. It is now marked delivered.',
        entityType: 'request',
        entityId: id,
      })
    }
    await dispatchDomainEvent(drizzle, {
      type: 'request_status_changed',
      entityId: id,
      entityType: 'request',
      orgId: request.orgId,
      data: {
        status: 'delivered',
        title: request.title,
        assigneeId: request.assigneeId ?? null,
        source: 'portal_approval',
      },
    })
  } catch {
    // Notification/event failures never fail the approval itself.
  }

  return NextResponse.json({ success: true, status: 'delivered' })
}
