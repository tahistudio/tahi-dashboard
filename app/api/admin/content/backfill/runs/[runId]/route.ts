/**
 * GET /api/admin/content/backfill/runs/[runId]
 *
 * Phase I · Slice 6.5 — per-item drill-down for a single backfill run.
 * Returns every row from blog_backfill_log for the given runId, sorted
 * by createdAt asc so the UI table reads top-to-bottom in run order.
 *
 * Used by the SlideOver on the /content-studio Health tab Backfill card.
 *
 * Contract:
 *   GET /api/admin/content/backfill/runs/{runId}
 *   200: { runId, items: BackfillRow[], counts: {...} }
 *   404 when no rows match runId (likely typo / very old purged run)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface BackfillRow {
  id: string
  webflowItemId: string
  postUrl: string
  postTitle: string | null
  status: string
  fieldsWritten: string[]
  errorMessage: string | null
  faqsGenerated: number | null
  takeawaysGenerated: number | null
  schemaCharsWritten: number | null
  durationMs: number | null
  createdAt: string
}

type Params = { params: Promise<{ runId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { runId } = await params
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }

  const database = await db()

  let rows: typeof schema.blogBackfillLog.$inferSelect[] = []
  try {
    rows = await database
      .select()
      .from(schema.blogBackfillLog)
      .where(eq(schema.blogBackfillLog.runId, runId))
      .orderBy(asc(schema.blogBackfillLog.createdAt))
  } catch (err) {
    console.error('backfill/runs/[runId]: query failed', err)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const items: BackfillRow[] = rows.map(r => {
    let fields: string[] = []
    if (r.fieldsWritten) {
      try {
        const parsed = JSON.parse(r.fieldsWritten)
        if (Array.isArray(parsed)) {
          fields = parsed.filter((s): s is string => typeof s === 'string')
        }
      } catch {
        // Older / corrupt rows — surface as empty rather than 500.
      }
    }
    return {
      id: r.id,
      webflowItemId: r.webflowItemId,
      postUrl: r.postUrl,
      postTitle: r.postTitle,
      status: r.status,
      fieldsWritten: fields,
      errorMessage: r.errorMessage,
      faqsGenerated: r.faqsGenerated,
      takeawaysGenerated: r.takeawaysGenerated,
      schemaCharsWritten: r.schemaCharsWritten,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }
  })

  const counts = {
    total: items.length,
    succeeded: items.filter(i => i.status === 'success').length,
    failed: items.filter(i => i.status === 'failed').length,
    skipped: items.filter(i => i.status === 'skipped').length,
  }

  return NextResponse.json({ runId, items, counts })
}
