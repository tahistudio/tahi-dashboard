/**
 * GET /api/admin/views/sections
 *
 * Aggregates share_section_views into the data shapes the new heatmap +
 * dwell-per-section + drop-off funnel + return-visit panels need.
 *
 * Query: ?resourceType=schedule&resourceId=<uuid>
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const resourceType = url.searchParams.get('resourceType') ?? ''
  const resourceId = url.searchParams.get('resourceId') ?? ''
  if (!resourceType || !resourceId) {
    return NextResponse.json({ error: 'resourceType + resourceId required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  // Pull all section view rows for this resource. Capped at 5000 in case
  // a hyperactive viewer somehow logged tens of thousands of events.
  const rows = await database
    .select()
    .from(schema.shareSectionViews)
    .where(and(
      eq(schema.shareSectionViews.resourceType, resourceType),
      eq(schema.shareSectionViews.resourceId, resourceId),
    ))
    .limit(5000)

  // Aggregate per section.
  interface SectionAgg {
    sectionId: string
    views: number
    uniqueSessions: Set<string>
    totalDwellMs: number
    maxDwellMs: number
  }
  const bySection = new Map<string, SectionAgg>()
  const sessionSet = new Set<string>()
  const sessionsBySection = new Map<string, Set<string>>()
  const sessionEventCount = new Map<string, number>()

  for (const r of rows) {
    sessionSet.add(r.sessionId)
    const agg = bySection.get(r.sectionId) ?? {
      sectionId: r.sectionId,
      views: 0,
      uniqueSessions: new Set<string>(),
      totalDwellMs: 0,
      maxDwellMs: 0,
    }
    agg.views += 1
    agg.uniqueSessions.add(r.sessionId)
    agg.totalDwellMs += r.dwellMs
    agg.maxDwellMs = Math.max(agg.maxDwellMs, r.dwellMs)
    bySection.set(r.sectionId, agg)

    const s = sessionsBySection.get(r.sectionId) ?? new Set<string>()
    s.add(r.sessionId)
    sessionsBySection.set(r.sectionId, s)

    sessionEventCount.set(r.sessionId, (sessionEventCount.get(r.sessionId) ?? 0) + 1)
  }

  const sections = Array.from(bySection.values()).map(a => ({
    sectionId: a.sectionId,
    views: a.views,
    uniqueSessions: a.uniqueSessions.size,
    totalDwellMs: a.totalDwellMs,
    avgDwellMs: Math.round(a.totalDwellMs / Math.max(1, a.views)),
    maxDwellMs: a.maxDwellMs,
  }))

  // Return-visits: sessions with ≥2 separate sectionId events OR multiple
  // dwell rows on the cover section. Using >1 dwell row as the proxy for
  // "came back" — same session that re-engaged with the document later.
  const returnVisits = Array.from(sessionEventCount.values()).filter(n => n >= 2).length

  return NextResponse.json({
    totalSessions: sessionSet.size,
    totalEvents: rows.length,
    returnVisits,
    sections,
  })
}
