import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { contactIdentityWhere } from '@/lib/portal-identity'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and, asc, inArray, isNull } from 'drizzle-orm'
import { actingByline, actingIdentity, recordActingWrite, refusePreviewWrite } from '@/lib/acting-as'
import { notifyTeamMember } from '@/lib/notifications'
import { dispatchDomainEvent } from '@/lib/events'
import { chunkThreadIds } from '@/lib/request-thread'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/portal/requests/[id] ────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId, clerkOrgId, contactId: previewContactId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied

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
  //
  // Through lib/portal-identity.ts, which also puts the org on the lookup: the
  // login alone could match a row at a different client org, and in Client view
  // it matches nothing at all, so the preview rendered the previewed client's
  // own messages as somebody else's.
  const [self] = userId
    ? await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(contactIdentityWhere(orgId, userId, previewContactId))
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
      // A message the studio deleted is gone here too. Both thread queries
      // used to ignore deletedAt, so a retracted message kept showing.
      isNull(schema.messages.deletedAt),
    ))
    .orderBy(asc(schema.messages.createdAt))

  // Attachments posted WITH a message, so the client sees the file under the
  // sentence that explains it instead of only in the Files panel (the admin
  // thread has always shown both). Keyed off the message ids resolved above,
  // which are already filtered to non-internal, non-deleted rows, so a file
  // stamped onto an internal note is unreachable through THIS endpoint. The
  // Files panel beside the thread (app/api/portal/requests/[id]/files) still
  // lists every file on the request with no message filter; closing that is
  // the next slice and is not claimed here.
  //
  // Sliced, because a thread is unbounded and D1 caps a statement at 100 bound
  // parameters: one IN over every visible message threw at roughly the 99th
  // and took the whole detail payload down with it.
  const msgIds = msgRows.map(m => m.id)
  type MessageFileRow = {
    id: string
    messageId: string | null
    filename: string
    storageKey: string
    mimeType: string | null
    sizeBytes: number | null
  }
  const fileRows: MessageFileRow[] = []
  for (const idSlice of chunkThreadIds(msgIds)) {
    const rows = await drizzle
      .select({
        id: schema.files.id,
        messageId: schema.files.messageId,
        filename: schema.files.filename,
        storageKey: schema.files.storageKey,
        mimeType: schema.files.mimeType,
        sizeBytes: schema.files.sizeBytes,
      })
      .from(schema.files)
      .where(and(
        inArray(schema.files.messageId, idSlice),
        // Belt and braces on top of the message scoping: never hand over a row
        // that belongs to another org.
        eq(schema.files.orgId, orgId),
      ))
    fileRows.push(...rows)
  }

  const filesByMessage = new Map<string, Array<{
    id: string
    filename: string
    storageKey: string
    mimeType: string | null
    sizeBytes: number | null
  }>>()
  for (const f of fileRows) {
    if (!f.messageId) continue
    const arr = filesByMessage.get(f.messageId) ?? []
    arr.push({
      id: f.id,
      filename: f.filename,
      storageKey: f.storageKey,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
    })
    filesByMessage.set(f.messageId, arr)
  }

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
      files: filesByMessage.get(m.id) ?? [],
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
  const auth = await getPortalAuth(req)
  const { orgId, userId, clerkOrgId } = auth

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  // OPEN in act mode. Same single transition as always (client_review ->
  // delivered); the only difference is that an acting approval leaves an audit
  // row saying the studio closed it, not the client.
  const previewDenied = refusePreviewWrite(auth, { allowActing: true })
  if (previewDenied) return previewDenied
  const acting = actingIdentity(auth)

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

  // Awaited ahead of the best-effort block below. The request is delivered
  // either way; whether anyone can later tell who delivered it is not
  // best-effort.
  await recordActingWrite(drizzle as unknown as DB, acting, {
    verb: 'request.approved',
    entityType: 'request',
    entityId: id,
    route: 'PATCH /api/portal/requests/[id]',
    extra: { from: 'client_review', to: 'delivered', title: request.title },
  })

  // Best-effort: tell the assignee the client approved, and fire the domain
  // event so automations/webhooks see the same status change the studio path
  // emits. Neither should block the approval response.
  try {
    if (request.assigneeId) {
      await notifyTeamMember(drizzle, request.assigneeId, {
        type: 'request_status_changed',
        title: acting
          ? `Approved for the client: "${request.title}"`
          : `Client approved "${request.title}"`,
        body: 'The client approved this delivery. It is now marked delivered.'
          + actingByline(acting, 'recorded'),
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
