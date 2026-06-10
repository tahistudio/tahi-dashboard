import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

// ── PUT /api/portal/capacity/reorder ───────────────────────────────────────
// Reorder the authenticated client's own queue, scoped to their org. Unlike the
// per-track reorder, this is not tied to a single track row, so it serves the
// custom and unified (tracks-off) modes where the board has no backing track.
// Mutation: uses getRequestAuth (not getPortalAuth) so a previewing admin in
// Client view cannot write to a real client's queue.
export async function PUT(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { requestIds?: string[] }
  const { requestIds } = body

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json(
      { error: 'requestIds must be a non-empty array of IDs' },
      { status: 400 }
    )
  }

  const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Update queueOrder for each request, but only if it belongs to the client's
  // org AND is client-visible (never reorder internal-only work).
  for (let i = 0; i < requestIds.length; i++) {
    const [request] = await drizzle
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.id, requestIds[i]),
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
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
