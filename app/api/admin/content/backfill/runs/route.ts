/**
 * GET /api/admin/content/backfill/runs
 *
 * Phase I · Slice 6.5 — list recent backfill runs grouped by runId.
 * Powers the "Backfill existing posts" card on the /content-studio Health
 * tab so Liam can see the last run summary at a glance.
 *
 * One row per run with:
 *   - runId
 *   - startedAt (earliest createdAt across the run's rows)
 *   - finishedAt (latest createdAt — close enough for at-a-glance)
 *   - total / succeeded / failed / skipped counts
 *   - sample of up to 3 failures (id + url + error) so the UI can
 *     hint at what broke without opening the per-run drill-down
 *
 * Contract:
 *   GET ?limit=10 (default 10, max 50)
 *   200: { runs: RunSummary[] }
 *   403 on non-admin.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  totalDurationMs: number
  sampleFailures: Array<{ id: string; url: string; error: string | null }>
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limitRaw = Number(searchParams.get('limit') ?? '10')
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10))

  const database = await db()

  // Pull the most recent 1000 rows (≈ 17 full Tahi runs of 57 posts each)
  // and group in-memory. D1 doesn't expose GROUP BY through Drizzle cleanly
  // without raw SQL — given the cap, JS aggregation is plenty fast.
  let rows: typeof schema.blogBackfillLog.$inferSelect[] = []
  try {
    rows = await database
      .select()
      .from(schema.blogBackfillLog)
      .orderBy(desc(schema.blogBackfillLog.createdAt))
      .limit(1000)
  } catch (err) {
    console.error('backfill/runs: query failed', err)
    return NextResponse.json({ runs: [] satisfies RunSummary[] })
  }

  const byRun = new Map<string, typeof schema.blogBackfillLog.$inferSelect[]>()
  for (const r of rows) {
    const arr = byRun.get(r.runId) ?? []
    arr.push(r)
    byRun.set(r.runId, arr)
  }

  // Sort runs by latest createdAt across the run, desc — i.e. most recent
  // run first. Cap at `limit`.
  const runs: RunSummary[] = []
  for (const [runId, items] of byRun.entries()) {
    let start = items[0].createdAt
    let end = items[0].createdAt
    let total = 0
    let succeeded = 0
    let failed = 0
    let skipped = 0
    let totalDurationMs = 0
    const failures: Array<{ id: string; url: string; error: string | null }> = []
    for (const it of items) {
      total++
      if (it.status === 'success') succeeded++
      else if (it.status === 'failed') failed++
      else if (it.status === 'skipped') skipped++
      totalDurationMs += it.durationMs ?? 0
      if (it.createdAt < start) start = it.createdAt
      if (it.createdAt > end) end = it.createdAt
      if (it.status === 'failed' && failures.length < 3) {
        failures.push({
          id: it.webflowItemId,
          url: it.postUrl,
          error: it.errorMessage,
        })
      }
    }
    runs.push({
      runId,
      startedAt: start,
      finishedAt: end,
      total,
      succeeded,
      failed,
      skipped,
      totalDurationMs,
      sampleFailures: failures,
    })
  }

  runs.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return NextResponse.json({ runs: runs.slice(0, limit) })
}
