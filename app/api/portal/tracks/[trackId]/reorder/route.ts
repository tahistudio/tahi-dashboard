import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

// ── PUT /api/portal/tracks/[trackId]/reorder ───────────────────────────────
// Client portal: reorder requests in a track queue, scoped to authenticated org.
// getPortalAuth resolves the D1 org id; impersonating admins are read-only.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the admin org
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const { trackId } = await params

  const body = await req.json() as { requestIds?: string[] }
  const { requestIds } = body

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json(
      { error: 'requestIds must be a non-empty array of IDs' },
      { status: 400 }
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify the track exists and belongs to a subscription for the client's org
  const [track] = await drizzle
    .select({
      id: schema.tracks.id,
      subscriptionId: schema.tracks.subscriptionId,
    })
    .from(schema.tracks)
    .where(eq(schema.tracks.id, trackId))
    .limit(1)

  if (!track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 })
  }

  // Verify the subscription belongs to the client's org
  const [sub] = await drizzle
    .select({ orgId: schema.subscriptions.orgId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, track.subscriptionId))
    .limit(1)

  if (!sub || sub.orgId !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Update position for each request, but only if the request belongs to the
  // client's org AND is client-visible (not an internal-only request).
  for (let i = 0; i < requestIds.length; i++) {
    // Verify each request belongs to this org before updating
    const [request] = await drizzle
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, requestIds[i]),
          eq(schema.requests.orgId, orgId),
          eq(schema.requests.isInternal, false)
        )
      )
      .limit(1)

    if (!request) {
      return NextResponse.json(
        { error: `Request ${requestIds[i]} not found or does not belong to your organisation` },
        { status: 403 }
      )
    }

    await drizzle
      .update(schema.requests)
      .set({ queueOrder: i, updatedAt: now })
      .where(eq(schema.requests.id, requestIds[i]))
  }

  return NextResponse.json({ success: true })
}
