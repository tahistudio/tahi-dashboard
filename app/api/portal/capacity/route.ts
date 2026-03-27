/**
 * GET /api/portal/capacity
 *
 * Returns the client org's subscription tracks and request queue.
 * Used by the TrackQueuePanel on the client overview page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, ne, asc } from 'drizzle-orm'
import { getTrackEntitlements, getTrackSummary } from '@/lib/plan-utils'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db() as unknown as D1

  // Fetch the active subscription
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
      eq(schema.subscriptions.orgId, orgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .limit(1)

  // Fetch tracks for this org's subscription
  const tracks = sub
    ? await database
        .select({
          id: schema.tracks.id,
          type: schema.tracks.type,
          isPriorityTrack: schema.tracks.isPriorityTrack,
          currentRequestId: schema.tracks.currentRequestId,
        })
        .from(schema.tracks)
        .where(eq(schema.tracks.subscriptionId, sub.id))
    : []

  // Fetch queued requests (active, not delivered/archived)
  const queued = await database
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      type: schema.requests.type,
      status: schema.requests.status,
      priority: schema.requests.priority,
      queueOrder: schema.requests.queueOrder,
      dueDate: schema.requests.dueDate,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, orgId),
      ne(schema.requests.status, 'delivered'),
      ne(schema.requests.status, 'archived'),
      eq(schema.requests.isInternal, false),
    ))
    .orderBy(asc(schema.requests.queueOrder), asc(schema.requests.createdAt))

  // Map currentRequestId → full request record
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
