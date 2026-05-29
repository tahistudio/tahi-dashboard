/**
 * POST /api/admin/cron/site-index-sync
 *
 * Weekly sync of tahi.studio's sitemap into the site_index table.
 * Pulls sitemap.xml, diffs against stored rows, Haiku-summarises new
 * or changed pages, deactivates pages the sitemap no longer references.
 *
 * Idempotent. Safe to fire ad-hoc from the dashboard or from a
 * scheduled cron. Time-budgeted to fit a Cloudflare Worker request.
 *
 * Contract:
 *   POST { maxPages?: number, budgetMs?: number }
 *   200: SyncResult { fetched, newRows, changedRows, unchangedRows, deactivated, errors }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncSiteIndex } from '@/lib/site-index'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { maxPages?: number; budgetMs?: number }

  const database = await db()
  try {
    const result = await syncSiteIndex(database, {
      maxPages: body.maxPages,
      budgetMs: body.budgetMs,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
