import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { normalizeCallInstant } from '@/lib/call-time'
import { logAudit } from '@/lib/audit'

// PATCH /api/admin/calls/[id] - update call
//
// This is the legacy scheduled_calls table (client check-ins booked by
// hand from a client's Calls tab), distinct from discovery_calls, the
// classifier-driven polymorphic table the /calls index actually reads
// (see db/schema.ts and PATCH /api/admin/discovery-calls/[id]). It has no
// leadId / dealId / requestId / meetingType columns, so relinking a call to
// a lead, deal or request belongs to that route instead. What this route
// owns: which client org the call is for (orgId, required, a check-in
// always belongs to a client) and what it's for (title, description).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    status?: string
    notes?: string
    recordingUrl?: string
    title?: string
    description?: string | null
    orgId?: string | null
    scheduledAt?: string
    durationMinutes?: number
    meetingUrl?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [call] = await drizzle
    .select({
      orgId: schema.scheduledCalls.orgId,
      title: schema.scheduledCalls.title,
      description: schema.scheduledCalls.description,
    })
    .from(schema.scheduledCalls)
    .where(eq(schema.scheduledCalls.id, id))
    .limit(1)
  if (!call) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, call.orgId)
  if (denied) return denied

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.status) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.recordingUrl !== undefined) updates.recordingUrl = body.recordingUrl
  if (body.title) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description?.trim() || null
  if (body.scheduledAt) {
    // Normalise to an absolute UTC instant at the boundary. A naive
    // value (no offset) is read as Pacific/Auckland wall-clock time.
    // See lib/call-time.ts.
    const normalized = normalizeCallInstant(body.scheduledAt)
    if (!normalized) {
      return NextResponse.json({ error: 'scheduledAt is not a valid date' }, { status: 400 })
    }
    updates.scheduledAt = normalized
  }
  if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes
  if (body.meetingUrl !== undefined) updates.meetingUrl = body.meetingUrl

  // orgId: the column is NOT NULL, so a check-in always belongs to a
  // client and an explicit null is refused rather than silently ignored.
  // A provided id must reference a real org, and the caller must have
  // access to that NEW org too, not just the one the call is leaving.
  if ('orgId' in body) {
    const requested = typeof body.orgId === 'string' ? body.orgId.trim() : body.orgId
    if (!requested) {
      return NextResponse.json({ error: 'orgId cannot be cleared' }, { status: 400 })
    }
    if (requested !== call.orgId) {
      const [org] = await drizzle
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, requested))
        .limit(1)
      if (!org) {
        return NextResponse.json({ error: 'orgId does not reference an existing organisation' }, { status: 400 })
      }
      const newOrgDenied = await requireAccessToOrg(drizzle, userId, requested)
      if (newOrgDenied) return newOrgDenied
      updates.orgId = requested
    }
  }

  await drizzle
    .update(schema.scheduledCalls)
    .set(updates)
    .where(eq(schema.scheduledCalls.id, id))

  // Audit the fields that change which client this call is for, or what
  // it's for.
  const auditedChanges: Record<string, { before: unknown; after: unknown }> = {}
  if ('orgId' in updates && updates.orgId !== call.orgId) {
    auditedChanges.orgId = { before: call.orgId, after: updates.orgId }
  }
  if ('title' in updates && updates.title !== call.title) {
    auditedChanges.title = { before: call.title, after: updates.title }
  }
  if ('description' in updates && updates.description !== call.description) {
    auditedChanges.description = { before: call.description, after: updates.description }
  }
  if (Object.keys(auditedChanges).length > 0) {
    await logAudit(drizzle as unknown as DB, {
      action: 'scheduled_call_updated',
      userId,
      userType: 'team_member',
      entityType: 'scheduled_call',
      entityId: id,
      metadata: { changes: auditedChanges },
    })
  }

  return NextResponse.json({ success: true })
}
