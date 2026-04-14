import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
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

  return NextResponse.json({ request })
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
