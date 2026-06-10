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
import { eq, and, ne, asc, gte, desc } from 'drizzle-orm'
import { getTrackEntitlements, getTracksConfigSummary, resolveTracksConfig, buildEffectiveTracks } from '@/lib/plan-utils'

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
      trackId: schema.requests.trackId,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, targetOrgId),
      ne(schema.requests.status, 'delivered'),
      ne(schema.requests.status, 'archived'),
    ))
    .orderBy(asc(schema.requests.queueOrder), asc(schema.requests.createdAt))

  // Recently-delivered (last 30 days) for the Delivered lane + header stats.
  const deliveredCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const delivered = await database
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      type: schema.requests.type,
      status: schema.requests.status,
      priority: schema.requests.priority,
      trackId: schema.requests.trackId,
      dueDate: schema.requests.dueDate,
      createdAt: schema.requests.createdAt,
      deliveredAt: schema.requests.deliveredAt,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, targetOrgId),
      eq(schema.requests.status, 'delivered'),
      gte(schema.requests.deliveredAt, deliveredCutoff),
    ))
    .orderBy(desc(schema.requests.deliveredAt))

  // Per-client tracks override (auto | custom | off). Wrapped so the endpoint
  // keeps working between deploy and the 0079 migration (missing columns throw).
  let org: { tracksMode: string | null; customSmallTracks: number | null; customLargeTracks: number | null } | undefined
  try {
    ;[org] = await database
      .select({
        tracksMode: schema.organisations.tracksMode,
        customSmallTracks: schema.organisations.customSmallTracks,
        customLargeTracks: schema.organisations.customLargeTracks,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, targetOrgId))
      .limit(1)
  } catch {
    org = undefined
  }

  const config = resolveTracksConfig(org, sub?.planType ?? null, sub?.hasPrioritySupport ?? false)

  const currentIds = tracks.map(t => t.currentRequestId).filter(Boolean) as string[]
  const activeRequests = queued.filter(r => currentIds.includes(r.id))
  const queuedRequests = queued.filter(r => !currentIds.includes(r.id))

  const effectiveTracks = config.mode === 'off'
    ? tracks.map(t => ({ id: t.id, type: t.type, isPriorityTrack: t.isPriorityTrack, currentRequestId: t.currentRequestId }))
    : buildEffectiveTracks(
        tracks.map(t => ({ id: t.id, type: t.type, isPriorityTrack: t.isPriorityTrack, currentRequestId: t.currentRequestId })),
        config.smallTracks,
        config.largeTracks,
      )

  const entitlements = getTrackEntitlements(sub?.planType ?? null, sub?.hasPrioritySupport ?? false)
  const summary = getTracksConfigSummary(config)

  return NextResponse.json({
    subscription: sub ?? null,
    entitlements,
    summary,
    tracksMode: config.mode,
    showGhosts: config.showGhosts,
    customSmallTracks: org?.customSmallTracks ?? 0,
    customLargeTracks: org?.customLargeTracks ?? 0,
    tracks: effectiveTracks.map(t => ({
      ...t,
      currentRequest: activeRequests.find(r => r.id === t.currentRequestId) ?? null,
    })),
    queue: queuedRequests,
    delivered,
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
