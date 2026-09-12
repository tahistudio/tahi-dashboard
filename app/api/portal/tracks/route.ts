import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, ne, asc } from 'drizzle-orm'
import { resolveTracksConfig, buildEffectiveTracks } from '@/lib/plan-utils'

// ── GET /api/portal/tracks ────────────────────────────────────────────────
// Client portal: return the authenticated org's tracks with active and queued
// requests. Internal-only requests (isInternal=true) are never exposed to the
// client, matching every other portal route.
//
// Lanes come from the org's resolved entitlement, not from the physical rows
// in the tracks table: a client on a custom 1 small + 1 large config with only
// one row was never shown their large lane at all. Same reconciliation
// app/api/portal/capacity uses, so the two boards cannot disagree.
export async function GET(req: NextRequest) {
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the admin org
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'tracks')
  if (featureDenied) return featureDenied

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Find active subscription for this org
  const [sub] = await drizzle
    .select({
      id: schema.subscriptions.id,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
      hasPrioritySupport: schema.subscriptions.hasPrioritySupport,
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

  // Per-client tracks override (auto | custom | off). Wrapped so the endpoint
  // keeps working on a pre-0079 environment, where the columns are missing.
  let org: { tracksMode: string | null; customSmallTracks: number | null; customLargeTracks: number | null } | undefined
  try {
    ;[org] = await drizzle
      .select({
        tracksMode: schema.organisations.tracksMode,
        customSmallTracks: schema.organisations.customSmallTracks,
        customLargeTracks: schema.organisations.customLargeTracks,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
  } catch {
    org = undefined
  }

  const config = resolveTracksConfig(org, sub.planType, !!sub.hasPrioritySupport)

  // Get all non-delivered/archived requests for this org, ordered by queue.
  // isInternal=false: internal admin-created requests stay hidden from the client.
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
      eq(schema.requests.isInternal, false),
      ne(schema.requests.status, 'delivered'),
      ne(schema.requests.status, 'archived'),
    ))
    .orderBy(asc(schema.requests.queueOrder), asc(schema.requests.createdAt))

  // Effective lanes: 'off' keeps the real rows (there is no track concept to
  // reconcile to), auto/custom reconcile to the resolved counts so a lane the
  // client is entitled to renders even with no backing row yet.
  const effectiveTracks: Array<{
    id: string
    type: string
    isPriorityTrack: number | boolean | null
    currentRequestId: string | null
    /** True for a synthetic entitlement-only lane with no backing tracks row. */
    synthetic?: boolean
  }> = config.mode === 'off'
    ? tracks
    : buildEffectiveTracks(tracks, config.smallTracks, config.largeTracks)

  const currentIds = effectiveTracks.map(t => t.currentRequestId).filter(Boolean) as string[]

  const items = effectiveTracks.map(t => ({
    id: t.id,
    type: t.type,
    isPriorityTrack: t.isPriorityTrack,
    // Additive marker so the client can tell an empty entitlement lane (no
    // backing row, id like "synthetic-large-0") from a real track: it has
    // nothing of its own to reorder.
    synthetic: t.synthetic === true,
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
