import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, ne, asc } from 'drizzle-orm'

// ── GET /api/portal/tracks ────────────────────────────────────────────────
// Client portal: return the authenticated org's tracks with active and queued tasks
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)

  // Deny if not authenticated or if this is the admin org
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Find active subscription for this org
  const [sub] = await drizzle
    .select({
      id: schema.subscriptions.id,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
    })
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.orgId, orgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .limit(1)

  if (!sub) {
    return NextResponse.json({ items: [], subscription: null })
  }

  // Get tracks for this subscription
  const tracks = await drizzle
    .select()
    .from(schema.tracks)
    .where(eq(schema.tracks.subscriptionId, sub.id))

  // Get all non-delivered/archived requests for this org, ordered by queue
  const requests = await drizzle
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
    ))
    .orderBy(asc(schema.requests.queueOrder), asc(schema.requests.createdAt))

  const currentIds = tracks.map(t => t.currentRequestId).filter(Boolean) as string[]

  const items = tracks.map(t => ({
    id: t.id,
    type: t.type,
    isPriorityTrack: t.isPriorityTrack,
    currentRequest: t.currentRequestId
      ? requests.find(r => r.id === t.currentRequestId) ?? null
      : null,
    queue: requests.filter(r =>
      !currentIds.includes(r.id) &&
      r.type === (t.type === 'small' ? 'small_task' : 'large_task')
    ),
  }))

  return NextResponse.json({
    items,
    subscription: {
      id: sub.id,
      planType: sub.planType,
      status: sub.status,
    },
  })
}
