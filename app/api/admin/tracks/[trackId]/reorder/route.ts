import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── PUT /api/admin/tracks/[trackId]/reorder ────────────────────────────────
// Reorder requests/tasks in a track queue by updating position fields
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  // Verify the track exists
  const [track] = await drizzle
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.id, trackId))
    .limit(1)

  if (!track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Update position for each request in order
  for (let i = 0; i < requestIds.length; i++) {
    await drizzle
      .update(schema.requests)
      .set({ queueOrder: i, updatedAt: now })
      .where(eq(schema.requests.id, requestIds[i]))
  }

  return NextResponse.json({ success: true })
}
