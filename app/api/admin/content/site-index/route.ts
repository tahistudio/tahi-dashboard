/**
 * GET /api/admin/content/site-index
 *
 * Returns every row in the site_index table for the UI table.
 * No pagination — Tahi's site is ~200 pages.
 *
 * Response: { rows: [...], counts: { total, byType: { blog, glossary, ... } } }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const rows = await database
    .select({
      id: schema.siteIndex.id,
      url: schema.siteIndex.url,
      relativeUrl: schema.siteIndex.relativeUrl,
      type: schema.siteIndex.type,
      title: schema.siteIndex.title,
      summary: schema.siteIndex.summary,
      lastSeenAt: schema.siteIndex.lastSeenAt,
      summarisedAt: schema.siteIndex.summarisedAt,
      isActive: schema.siteIndex.isActive,
    })
    .from(schema.siteIndex)
    .orderBy(desc(schema.siteIndex.lastSeenAt))

  const byType: Record<string, number> = {}
  let activeCount = 0
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1
    if (r.isActive) activeCount++
  }

  return NextResponse.json({
    rows,
    counts: {
      total: rows.length,
      active: activeCount,
      byType,
    },
  })
}
