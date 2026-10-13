import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray } from 'drizzle-orm'

// ── PUT /api/admin/tracks/[trackId]/reorder ────────────────────────────────
// Reorder requests/tasks in a track queue by updating position fields
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const featureDenied = await requireFeature({ userId, orgId }, 'requests')
  if (featureDenied) return featureDenied

  const { trackId } = await params

  const body = await req.json() as { requestIds?: string[] }
  const { requestIds } = body

  if (!Array.isArray(requestIds) || requestIds.length === 0 || requestIds.some(id => typeof id !== 'string' || !id)) {
    return NextResponse.json(
      { error: 'requestIds must be a non-empty array of IDs' },
      { status: 400 }
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify the track exists
  const [track] = await drizzle
    .select({ id: schema.tracks.id, orgId: schema.subscriptions.orgId })
    .from(schema.tracks)
    .innerJoin(schema.subscriptions, eq(schema.tracks.subscriptionId, schema.subscriptions.id))
    .where(eq(schema.tracks.id, trackId))
    .limit(1)

  if (!track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, track.orgId)
  if (denied) return denied

  const uniqueIds = [...new Set(requestIds)]
  const matchedIds = new Set<string>()
  for (let offset = 0; offset < uniqueIds.length; offset += 90) {
    const requests = await drizzle.select({ id: schema.requests.id }).from(schema.requests)
      .where(and(eq(schema.requests.orgId, track.orgId), inArray(schema.requests.id, uniqueIds.slice(offset, offset + 90))))
    for (const request of requests) matchedIds.add(request.id)
  }
  if (matchedIds.size !== uniqueIds.length) {
    return NextResponse.json({ error: 'Every request must belong to the track client' }, { status: 400 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Update position for each request in order
  for (let i = 0; i < requestIds.length; i++) {
    await drizzle
      .update(schema.requests)
      .set({ queueOrder: i, updatedAt: now })
      .where(and(eq(schema.requests.id, requestIds[i]), eq(schema.requests.orgId, track.orgId)))
  }

  return NextResponse.json({ success: true })
}
