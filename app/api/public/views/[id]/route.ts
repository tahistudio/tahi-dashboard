import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── POST /api/public/views/[id] ────────────────────────────────────
// Heartbeat for an existing share-view event. Updates endedAt + durationMs
// and optionally appends to pagesViewed and sets viewerName / viewerEmail.
//
// Scope check: we require sessionId in the body matching the original
// event — prevents one viewer's heartbeats from updating another's event
// even if they somehow guessed the viewId.
//
// Designed to be called via navigator.sendBeacon, so the request is fire-
// and-forget. We always return 204 No Content (or 4xx for malformed input)
// regardless of whether the event was found.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params
  let body: {
    sessionId?: string
    pagesViewed?: string[]
    viewerName?: string
    viewerEmail?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  // Find the event + verify it belongs to this session.
  const [event] = await database
    .select({
      id: schema.shareViewEvents.id,
      sessionId: schema.shareViewEvents.sessionId,
      startedAt: schema.shareViewEvents.startedAt,
      pagesViewed: schema.shareViewEvents.pagesViewed,
    })
    .from(schema.shareViewEvents)
    .where(and(eq(schema.shareViewEvents.id, id), eq(schema.shareViewEvents.sessionId, body.sessionId)))
    .limit(1)

  if (!event) {
    // Same response shape regardless of cause — don't leak whether the id exists.
    return new Response(null, { status: 204 })
  }

  const now = new Date().toISOString()
  const durationMs = Math.max(0, new Date(now).getTime() - new Date(event.startedAt).getTime())

  // Merge pagesViewed: union of existing + new.
  let mergedPages: string | null = event.pagesViewed
  if (body.pagesViewed?.length) {
    let prev: string[] = []
    if (event.pagesViewed) {
      try { prev = JSON.parse(event.pagesViewed) as string[] } catch { prev = [] }
    }
    const set = new Set([...prev, ...body.pagesViewed])
    mergedPages = JSON.stringify([...set])
  }

  const updates: Record<string, unknown> = {
    endedAt: now,
    durationMs,
    pagesViewed: mergedPages,
  }
  if (body.viewerName?.trim()) updates.viewerName = body.viewerName.trim()
  if (body.viewerEmail?.trim()) updates.viewerEmail = body.viewerEmail.trim()

  await database
    .update(schema.shareViewEvents)
    .set(updates)
    .where(eq(schema.shareViewEvents.id, id))

  return new Response(null, { status: 204 })
}
