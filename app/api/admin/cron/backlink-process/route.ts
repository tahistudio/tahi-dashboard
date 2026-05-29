/**
 * POST /api/admin/cron/backlink-process
 *
 * Drains the back-link queue: for each newly published post, finds the
 * top old posts at >= 0.72 similarity, applies spam guards (per-new cap
 * 5, lifetime cap 8, 30-day cooldown), and PATCHes Webflow to insert
 * an inline contextual link into each chosen old post.
 *
 * Time-budgeted to a single Worker request. Schedule this every ~10
 * minutes; one tick processes up to 3 jobs.
 *
 * Contract:
 *   POST { maxJobs?, budgetMs? }
 *   200: BacklinkProcessResult
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processBacklinkQueue } from '@/lib/backlink-processor'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { maxJobs?: number; budgetMs?: number }

  const database = await db()
  try {
    const result = await processBacklinkQueue(database, {
      maxJobs: body.maxJobs,
      budgetMs: body.budgetMs,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
