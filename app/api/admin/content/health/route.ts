/**
 * GET /api/admin/content/health
 *
 * Returns the latest blog_health snapshot. One row per URL.
 *
 * Sort: by index_status priority (FAIL → PARTIAL → NEUTRAL → UNKNOWN →
 * PASS — the broken stuff floats to the top so Liam sees what needs
 * fixing first), then alphabetically by URL.
 *
 * Contract (must stay stable — frontend Health tab depends on it):
 *   {
 *     rows: Array<{
 *       url, lastCheckedAt, indexStatus, coverageState, pageFetchState,
 *       robotsTxtState, indexingState, userCanonical, googleCanonical,
 *       inboundInternalLinks, wordCount, source
 *     }>,
 *     summary: {
 *       total: number,
 *       byStatus: { PASS, PARTIAL, FAIL, NEUTRAL, UNKNOWN, NULL: number },
 *       lastScanAt: string | null,
 *     }
 *   }
 *
 * `raw` is intentionally NOT returned — it can be large and the UI
 * doesn't render it. Fetch on-demand for debugging via a future
 * /api/admin/content/health/[url] route if needed.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

export const dynamic = 'force-dynamic'

// Sort priority — broken first. Anything not in the map sorts last.
const STATUS_RANK: Record<string, number> = {
  FAIL: 0,
  PARTIAL: 1,
  NEUTRAL: 2,
  UNKNOWN: 3,
  PASS: 4,
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const rows = await database
    .select({
      url: schema.blogHealth.url,
      lastCheckedAt: schema.blogHealth.lastCheckedAt,
      indexStatus: schema.blogHealth.indexStatus,
      coverageState: schema.blogHealth.coverageState,
      pageFetchState: schema.blogHealth.pageFetchState,
      robotsTxtState: schema.blogHealth.robotsTxtState,
      indexingState: schema.blogHealth.indexingState,
      userCanonical: schema.blogHealth.userCanonical,
      googleCanonical: schema.blogHealth.googleCanonical,
      inboundInternalLinks: schema.blogHealth.inboundInternalLinks,
      wordCount: schema.blogHealth.wordCount,
      source: schema.blogHealth.source,
    })
    .from(schema.blogHealth)
    .catch(() => [] as Array<{
      url: string
      lastCheckedAt: string
      indexStatus: string | null
      coverageState: string | null
      pageFetchState: string | null
      robotsTxtState: string | null
      indexingState: string | null
      userCanonical: string | null
      googleCanonical: string | null
      inboundInternalLinks: number | null
      wordCount: number | null
      source: string
    }>)

  // Sort: status rank (broken first) then URL alpha
  rows.sort((a, b) => {
    const ra = STATUS_RANK[a.indexStatus ?? ''] ?? 99
    const rb = STATUS_RANK[b.indexStatus ?? ''] ?? 99
    if (ra !== rb) return ra - rb
    return a.url.localeCompare(b.url)
  })

  // Summary aggregate
  const byStatus: Record<string, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, NEUTRAL: 0, UNKNOWN: 0, NULL: 0 }
  let lastScanAt: string | null = null
  for (const r of rows) {
    const key = r.indexStatus && byStatus[r.indexStatus] !== undefined ? r.indexStatus : (r.indexStatus ? 'UNKNOWN' : 'NULL')
    byStatus[key] = (byStatus[key] ?? 0) + 1
    if (r.lastCheckedAt && (!lastScanAt || r.lastCheckedAt > lastScanAt)) {
      lastScanAt = r.lastCheckedAt
    }
  }

  return NextResponse.json({
    rows,
    summary: {
      total: rows.length,
      byStatus,
      lastScanAt,
    },
  })
}
