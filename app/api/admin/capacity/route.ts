/**
 * GET /api/admin/capacity?orgId=...
 *
 * Returns an org's subscription tracks + request queue.
 * Used by admin in the client detail page.
 *
 * PATCH /api/admin/capacity/reorder
 * Body: { requestId: string, queueOrder: number }
 * Admin reorders a request in the queue.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, ne, asc } from 'drizzle-orm'
import { getTrackEntitlements, getTrackSummary } from '@/lib/plan-utils'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId: authOrgId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targetOrgId = new URL(req.url).searchParams.get('orgId')
  if (!targetOrgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  const database = await db() as unknown as D1

  const [sub] = await database
    .select({
      id: schema.subscriptions.id,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
      hasPrioritySupport: schema.subscriptions.hasPrioritySupport,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
    })
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.orgId, targetOrgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .limit(1)

  const tracks = sub
    ? await database
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.subscriptionId, sub.id))
    : []

  const queued = await database
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      type: schema.requests.type,
      status: schema.requests.status,
      priority: schema.requests.priority,
      queueOrder: schema.requests.queueOrder,
      dueDate: schema.requests.dueDate,
      assigneeId: schema.requests.assigneeId,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, targetOrgId),
      ne(schema.requests.status, 'delivered'),
      ne(schema.requests.status, 'archived'),
    ))
    .orderBy(asc(schema.requests.queueOrder), asc(schema.requests.createdAt))

  const currentIds = tracks.map(t => t.currentRequestId).filter(Boolean) as string[]
  const activeRequests = queued.filter(r => currentIds.includes(r.id))
  const queuedRequests = queued.filter(r => !currentIds.includes(r.id))

  const entitlements = getTrackEntitlements(sub?.planType ?? null, sub?.hasPrioritySupport ?? false)
  const summary = getTrackSummary(sub?.planType ?? null, sub?.hasPrioritySupport ?? false)

  return NextResponse.json({
    subscription: sub ?? null,
    entitlements,
    summary,
    tracks: tracks.map(t => ({
      ...t,
      currentRequest: activeRequests.find(r => r.id === t.currentRequestId) ?? null,
    })),
    queue: queuedRequests,
  })
}

// PATCH : reorder a request in the queue
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { requestId: string; queueOrder: number }
  if (!body.requestId || body.queueOrder === undefined) {
    return NextResponse.json({ error: 'requestId and queueOrder required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  await database
    .update(schema.requests)
    .set({ queueOrder: body.queueOrder, updatedAt: new Date().toISOString() })
    .where(eq(schema.requests.id, body.requestId))

  return NextResponse.json({ ok: true })
}
