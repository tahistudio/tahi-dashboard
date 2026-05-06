import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/views?resourceType=schedule&resourceId=X ────────────
// Returns analytics for a specific shared resource:
//   - totals: views, unique sessions, unique countries
//   - aggregates: avg / total duration, last viewed
//   - timeline: most recent N events with country / duration / when
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const resourceType = url.searchParams.get('resourceType')
  const resourceId = url.searchParams.get('resourceId')
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))

  if (!resourceType || !resourceId) {
    return NextResponse.json({ error: 'resourceType and resourceId required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const where = and(
    eq(schema.shareViewEvents.resourceType, resourceType),
    eq(schema.shareViewEvents.resourceId, resourceId),
  )

  // Aggregate stats — single query, returns one row.
  const [stats] = await database
    .select({
      totalViews: sql<number>`COUNT(*)`,
      uniqueSessions: sql<number>`COUNT(DISTINCT ${schema.shareViewEvents.sessionId})`,
      uniqueCountries: sql<number>`COUNT(DISTINCT ${schema.shareViewEvents.viewerCountry})`,
      totalDurationMs: sql<number>`COALESCE(SUM(${schema.shareViewEvents.durationMs}), 0)`,
      avgDurationMs: sql<number>`COALESCE(CAST(AVG(${schema.shareViewEvents.durationMs}) AS INTEGER), 0)`,
      maxDurationMs: sql<number>`COALESCE(MAX(${schema.shareViewEvents.durationMs}), 0)`,
      firstViewedAt: sql<string | null>`MIN(${schema.shareViewEvents.startedAt})`,
      lastViewedAt: sql<string | null>`MAX(${schema.shareViewEvents.startedAt})`,
    })
    .from(schema.shareViewEvents)
    .where(where)

  // Recent events — most recent first.
  const events = await database
    .select({
      id: schema.shareViewEvents.id,
      sessionId: schema.shareViewEvents.sessionId,
      viewerName: schema.shareViewEvents.viewerName,
      viewerEmail: schema.shareViewEvents.viewerEmail,
      viewerCountry: schema.shareViewEvents.viewerCountry,
      viewerUa: schema.shareViewEvents.viewerUa,
      referrer: schema.shareViewEvents.referrer,
      pagesViewed: schema.shareViewEvents.pagesViewed,
      startedAt: schema.shareViewEvents.startedAt,
      endedAt: schema.shareViewEvents.endedAt,
      durationMs: schema.shareViewEvents.durationMs,
    })
    .from(schema.shareViewEvents)
    .where(where)
    .orderBy(desc(schema.shareViewEvents.startedAt))
    .limit(limit)

  return NextResponse.json({
    stats: {
      totalViews: stats?.totalViews ?? 0,
      uniqueSessions: stats?.uniqueSessions ?? 0,
      uniqueCountries: stats?.uniqueCountries ?? 0,
      totalDurationMs: stats?.totalDurationMs ?? 0,
      avgDurationMs: stats?.avgDurationMs ?? 0,
      maxDurationMs: stats?.maxDurationMs ?? 0,
      firstViewedAt: stats?.firstViewedAt ?? null,
      lastViewedAt: stats?.lastViewedAt ?? null,
    },
    events,
  })
}
