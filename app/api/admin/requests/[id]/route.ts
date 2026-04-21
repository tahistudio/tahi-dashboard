import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc, count, gt, isNull, inArray } from 'drizzle-orm'
import { createNotifications } from '@/lib/notifications'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/requests/[id] ─────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping
  const [ownerRow] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, ownerRow?.orgId)
  if (denied) return denied

  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      orgName: schema.organisations.name,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      description: schema.requests.description,
      status: schema.requests.status,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      assigneeName: schema.teamMembers.name,
      estimatedHours: schema.requests.estimatedHours,
      startDate: schema.requests.startDate,
      dueDate: schema.requests.dueDate,
      revisionCount: schema.requests.revisionCount,
      maxRevisions: schema.requests.maxRevisions,
      scopeFlagged: schema.requests.scopeFlagged,
      isInternal: schema.requests.isInternal,
      tags: schema.requests.tags,
      requestNumber: schema.requests.requestNumber,
      checklists: schema.requests.checklists,
      // V3 additions
      size: schema.requests.size,
      parentRequestId: schema.requests.parentRequestId,
      subPosition: schema.requests.subPosition,
      scopeFlagReason: schema.requests.scopeFlagReason,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .leftJoin(schema.teamMembers, eq(schema.requests.assigneeId, schema.teamMembers.id))
    .where(eq(schema.requests.id, id))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // --- V3 enrichments: participants, sub-requests, parent, unread count, active timer ---

  // Participants (active only)
  const participantRows = await drizzle
    .select()
    .from(schema.requestParticipants)
    .where(and(
      eq(schema.requestParticipants.requestId, id),
      isNull(schema.requestParticipants.removedAt),
    ))

  // Resolve names
  const memberIds = participantRows.filter(p => p.participantType === 'team_member').map(p => p.participantId)
  const contactIds = participantRows.filter(p => p.participantType === 'contact').map(p => p.participantId)
  const memberMap = memberIds.length
    ? new Map((await drizzle.select({ id: schema.teamMembers.id, name: schema.teamMembers.name, avatar: schema.teamMembers.avatarUrl }).from(schema.teamMembers).where(inArray(schema.teamMembers.id, memberIds))).map(m => [m.id, m]))
    : new Map()
  const contactMap = contactIds.length
    ? new Map((await drizzle.select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts).where(inArray(schema.contacts.id, contactIds))).map(c => [c.id, c]))
    : new Map()

  const participants = participantRows.map(p => ({
    id: p.id,
    participantId: p.participantId,
    participantType: p.participantType,
    role: p.role,
    addedAt: p.addedAt,
    name: p.participantType === 'team_member'
      ? memberMap.get(p.participantId)?.name ?? null
      : contactMap.get(p.participantId)?.name ?? null,
    avatar: p.participantType === 'team_member' ? memberMap.get(p.participantId)?.avatar ?? null : null,
    email: p.participantType === 'contact' ? contactMap.get(p.participantId)?.email ?? null : null,
  }))

  // Sub-requests (direct children only)
  const subRequests = await drizzle
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      size: schema.requests.size,
      assigneeId: schema.requests.assigneeId,
      assigneeName: schema.teamMembers.name,
      dueDate: schema.requests.dueDate,
      requestNumber: schema.requests.requestNumber,
      subPosition: schema.requests.subPosition,
    })
    .from(schema.requests)
    .leftJoin(schema.teamMembers, eq(schema.requests.assigneeId, schema.teamMembers.id))
    .where(eq(schema.requests.parentRequestId, id))
    .orderBy(asc(schema.requests.subPosition), asc(schema.requests.createdAt))

  // Parent (if this request has one)
  let parent: { id: string; title: string; requestNumber: number | null } | null = null
  if (request.parentRequestId) {
    const [p] = await drizzle
      .select({ id: schema.requests.id, title: schema.requests.title, requestNumber: schema.requests.requestNumber })
      .from(schema.requests)
      .where(eq(schema.requests.id, request.parentRequestId))
      .limit(1)
    parent = p ?? null
  }

  // Unread count — messages created after this user's lastReadAt on this request.
  let unreadCount = 0
  if (userId) {
    const [readRow] = await drizzle
      .select({ lastReadAt: schema.requestReads.lastReadAt })
      .from(schema.requestReads)
      .where(and(
        eq(schema.requestReads.requestId, id),
        eq(schema.requestReads.userId, userId),
        eq(schema.requestReads.userType, 'team_member'),
      ))
      .limit(1)
    const since = readRow?.lastReadAt ?? '1970-01-01T00:00:00Z'
    const [cnt] = await drizzle
      .select({ n: count() })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.requestId, id),
        gt(schema.messages.createdAt, since),
      ))
    unreadCount = Number(cnt?.n ?? 0)
  }

  // Active timer (current user's timer if it's on THIS request)
  let activeTimer: {
    id: string
    startedAt: string
    pausedAt: string | null
    pausedSeconds: number
  } | null = null
  if (userId) {
    const [t] = await drizzle
      .select({
        id: schema.activeTimers.id,
        startedAt: schema.activeTimers.startedAt,
        pausedAt: schema.activeTimers.pausedAt,
        pausedSeconds: schema.activeTimers.pausedSeconds,
      })
      .from(schema.activeTimers)
      .where(and(
        eq(schema.activeTimers.userId, userId),
        eq(schema.activeTimers.requestId, id),
      ))
      .limit(1)
    activeTimer = t ?? null
  }

  return NextResponse.json({
    request,
    participants,
    subRequests,
    parent,
    unreadCount,
    activeTimer,
  })
}

// ── PATCH /api/admin/requests/[id] ───────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    status?: string
    priority?: string
    assigneeId?: string | null
    estimatedHours?: number | null
    startDate?: string | null
    dueDate?: string | null
    scopeFlagged?: boolean
    trackId?: string | null
    checklists?: string
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) {
    patch.status = body.status
    if (body.status === 'delivered') patch.deliveredAt = now
  }
  if (body.priority !== undefined) patch.priority = body.priority
  if ('assigneeId' in body) patch.assigneeId = body.assigneeId ?? null
  if ('estimatedHours' in body) patch.estimatedHours = body.estimatedHours ?? null
  if ('startDate' in body) patch.startDate = body.startDate ?? null
  if ('dueDate' in body) patch.dueDate = body.dueDate ?? null
  if (body.scopeFlagged !== undefined) patch.scopeFlagged = body.scopeFlagged
  if ('trackId' in body) patch.trackId = body.trackId ?? null
  if (body.checklists !== undefined) patch.checklists = body.checklists

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping
  const [ownerRow] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, ownerRow?.orgId)
  if (denied) return denied

  await drizzle
    .update(schema.requests)
    .set(patch)
    .where(eq(schema.requests.id, id))

  // Send notifications on status change
  if (body.status !== undefined) {
    // Fetch the request to get orgId and assigneeId
    const [updatedReq] = await drizzle
      .select({
        title: schema.requests.title,
        orgId: schema.requests.orgId,
        assigneeId: schema.requests.assigneeId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1)

    if (updatedReq) {
      const statusLabel = body.status.replace(/_/g, ' ')
      const notifTitle = `Request "${updatedReq.title}" status changed to ${statusLabel}`
      const recipients: Array<{ userId: string; userType: 'team_member' | 'contact' }> = []

      // Notify the assignee (if one exists)
      if (updatedReq.assigneeId) {
        recipients.push({ userId: updatedReq.assigneeId, userType: 'team_member' })
      }

      // Notify the primary contact at the client org
      const contacts = await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, updatedReq.orgId))
        .limit(5)

      for (const c of contacts) {
        recipients.push({ userId: c.id, userType: 'contact' })
      }

      await createNotifications(drizzle, recipients, {
        type: 'request_status_changed',
        title: notifTitle,
        body: `Status is now "${statusLabel}"`,
        entityType: 'request',
        entityId: id,
      })
    }
  }

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/requests/[id] ──────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping
  const [ownerRow] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, ownerRow?.orgId)
  if (denied) return denied

  // Soft-delete: archive rather than destroy
  await drizzle
    .update(schema.requests)
    .set({ status: 'archived', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.requests.id, id)))

  return NextResponse.json({ success: true })
}
