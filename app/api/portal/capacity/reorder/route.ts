import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { trackCanHandle } from '@/lib/plan-utils'

// ── PUT /api/portal/capacity/reorder ───────────────────────────────────────
// Reorder the authenticated client's own queue, scoped to their org. Unlike the
// per-track reorder, this is not tied to a single track row, so it serves the
// custom and unified (tracks-off) modes where the board has no backing track.
//
// Also supports a cross-track MOVE: pass `trackId` and `requestIds` is the new
// ordered "Up next" lane of that TARGET track. The move is type-validated so a
// large_task can never land in a small track.
//
// Mutation: getPortalAuth resolves the D1 org id (so the scope works for
// clerkOrgId-provisioned clients), and we reject impersonating so a previewing
// admin in Client view still cannot write to a real client's queue.
export async function PUT(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const body = await req.json() as { trackId?: string; requestIds?: string[] }
  const { trackId, requestIds } = body

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json(
      { error: 'requestIds must be a non-empty array of IDs' },
      { status: 400 }
    )
  }

  const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // A cross-track move is requested when a concrete trackId is supplied that is
  // not the unified board. Resolve the target track type so we can type-check
  // every request before writing anything.
  const isMove = typeof trackId === 'string' && trackId !== 'unified'
  let targetType: 'small' | 'large' | null = null

  if (isMove) {
    if (trackId!.startsWith('synthetic-')) {
      // synthetic-<type>-<index>: the type is the segment between the
      // 'synthetic-' prefix and the final '-N' index.
      const middle = trackId!.slice('synthetic-'.length).replace(/-\d+$/, '')
      if (middle === 'small' || middle === 'large') {
        targetType = middle
      } else {
        return NextResponse.json(
          { error: `Cannot determine track type from "${trackId}"` },
          { status: 400 }
        )
      }
    } else {
      // Real tracks row: read its type and confirm it belongs to a subscription
      // owned by the authenticated org.
      const [track] = await drizzle
        .select({ type: schema.tracks.type })
        .from(schema.tracks)
        .innerJoin(schema.subscriptions, eq(schema.tracks.subscriptionId, schema.subscriptions.id))
        .where(and(
          eq(schema.tracks.id, trackId!),
          eq(schema.subscriptions.orgId, orgId),
        ))
        .limit(1)

      if (!track || (track.type !== 'small' && track.type !== 'large')) {
        return NextResponse.json(
          { error: 'Track not found or does not belong to your organisation' },
          { status: 403 }
        )
      }
      targetType = track.type
    }
  }

  // Only a REAL track row's id may be written to requests.track_id. Synthetic
  // shells (custom mode) have no backing row, so we validate the type but leave
  // trackId untouched (D1 does not enforce the FK, so writing the string would
  // silently persist garbage).
  const persistTrackId = isMove && !trackId!.startsWith('synthetic-')

  // PASS 1 — validate ownership + type for EVERY request before writing
  // anything, so a mid-list violation can't leave the queue half-reordered.
  for (const reqId of requestIds) {
    const [request] = await drizzle
      .select({ id: schema.requests.id, type: schema.requests.type })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.id, reqId),
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
      .limit(1)

    if (!request) {
      return NextResponse.json(
        { error: `Request ${reqId} not found or does not belong to your organisation` },
        { status: 403 }
      )
    }

    // Hard rule: a large_task may never land in a small track.
    if (isMove && targetType && !trackCanHandle(targetType, request.type)) {
      return NextResponse.json(
        { error: `Request ${reqId} cannot move to a ${targetType} track` },
        { status: 400 }
      )
    }
  }

  // PASS 2 — write the new order (and, for a real-track move, the trackId).
  for (let i = 0; i < requestIds.length; i++) {
    await drizzle
      .update(schema.requests)
      .set(persistTrackId
        ? { trackId, queueOrder: i, updatedAt: now }
        : { queueOrder: i, updatedAt: now })
      .where(eq(schema.requests.id, requestIds[i]))
  }

  return NextResponse.json({ success: true })
}
