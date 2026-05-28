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
 *     aggregate: {
 *       total, indexed, notIndexed, partial, unknown, lastScanAt
 *     },
 *     lastError: string | null    // most recent per-URL error message,
 *                                 // surfaced when every row is errored
 *                                 // so the UI can show a real diagnostic
 *                                 // instead of "no data".
 *   }
 *
 * `raw` is mostly NOT returned, but we DO peek at it to pull out the
 * latest error message for the diagnostic banner.
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
  type HealthRowFull = {
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
    raw: string | null
  }
  const allRows: HealthRowFull[] = await database
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
      raw: schema.blogHealth.raw,
    })
    .from(schema.blogHealth)
    .catch(() => [] as HealthRowFull[])

  // Sort: status rank (broken first) then URL alpha
  allRows.sort((a, b) => {
    const ra = STATUS_RANK[a.indexStatus ?? ''] ?? 99
    const rb = STATUS_RANK[b.indexStatus ?? ''] ?? 99
    if (ra !== rb) return ra - rb
    return a.url.localeCompare(b.url)
  })

  // Aggregate. Buckets match the HealthAggregate shape the Health tab UI
  // reads (`data.aggregate.{indexed,notIndexed,partial,unknown,lastScanAt}`).
  let indexed = 0
  let notIndexed = 0
  let partial = 0
  let unknown = 0
  let lastScanAt: string | null = null
  let lastError: string | null = null
  let lastErrorAt: string | null = null
  for (const r of allRows) {
    switch (r.indexStatus) {
      case 'PASS': indexed++; break
      case 'FAIL': notIndexed++; break
      case 'PARTIAL':
      case 'NEUTRAL': partial++; break
      default: unknown++
    }
    if (r.lastCheckedAt && (!lastScanAt || r.lastCheckedAt > lastScanAt)) {
      lastScanAt = r.lastCheckedAt
    }
    // Pull the most-recent per-URL error from `raw` so the UI can show a
    // real diagnostic when every row failed. The scan route stores
    // {error, siteUrl} JSON for error rows; harmless on success rows.
    if (r.indexStatus == null && r.raw && (!lastErrorAt || r.lastCheckedAt > lastErrorAt)) {
      try {
        const parsed = JSON.parse(r.raw) as { error?: string }
        if (parsed?.error) {
          lastError = parsed.error
          lastErrorAt = r.lastCheckedAt
        }
      } catch { /* ignore unparseable raw */ }
    }
  }

  // Strip `raw` from the wire response — large + UI doesn't render it.
  const rows = allRows.map(({ raw: _raw, ...rest }) => rest)

  return NextResponse.json({
    rows,
    aggregate: {
      total: allRows.length,
      indexed,
      notIndexed,
      partial,
      unknown,
      lastScanAt,
    },
    lastError,
  })
}
