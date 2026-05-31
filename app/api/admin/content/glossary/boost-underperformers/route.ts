/**
 * GET  /api/admin/content/glossary/boost-underperformers
 *   List the top-N underperforming glossary terms based on GSC data.
 *   Read-only — returns the queue, doesn't trigger anything.
 *
 * POST /api/admin/content/glossary/boost-underperformers
 *   Body: { topN?: number, autoRewrite?: boolean }
 *   When autoRewrite=true, runs Tier 3 rewrite on each underperformer
 *   sequentially (cost ~$0.30 per item). Bounded by topN + worker
 *   budget. Returns per-item status.
 *
 * Reads from post_scorecards (populated by the existing scorecard
 * sync cron). Items with no scorecard yet are excluded — run the
 * scorecard sync first.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rankUnderperformingItems } from '@/lib/seo-signals'
import { generateGlossaryEntry } from '@/lib/glossary-pipeline'

export const dynamic = 'force-dynamic'

const BUDGET_MS = 25_000

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const topN = Math.max(1, Math.min(50, parseInt(searchParams.get('topN') ?? '20', 10) || 20))
  const typeParam = searchParams.get('type')
  const type: 'glossary' | 'blog' | 'all' = typeParam === 'blog' || typeParam === 'all' ? typeParam : 'glossary'
  const database = await db()
  if (type === 'all') {
    const [glossary, blog] = await Promise.all([
      rankUnderperformingItems(database, 'glossary', topN),
      rankUnderperformingItems(database, 'blog', topN),
    ])
    return NextResponse.json({
      scanned: glossary.scanned + blog.scanned,
      underperformers: [...glossary.underperformers, ...blog.underperformers]
        .sort((a, b) => b.underperformanceScore - a.underperformanceScore)
        .slice(0, topN),
      unindexedItems: [...glossary.unindexedItems, ...blog.unindexedItems],
      durationMs: glossary.durationMs + blog.durationMs,
    })
  }
  const result = await rankUnderperformingItems(database, type, topN)
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { topN?: number; autoRewrite?: boolean }
  const topN = Math.max(1, Math.min(20, body.topN ?? 5))  // hard cap 20 — this is expensive
  const autoRewrite = !!body.autoRewrite

  const database = await db()
  const t0 = Date.now()
  const ranking = await rankUnderperformingItems(database, 'glossary', topN)

  if (!autoRewrite) {
    return NextResponse.json({
      mode: 'dry-run',
      ...ranking,
      note: 'Pass { autoRewrite: true } to fire Tier 3 rewrites on these.',
    })
  }

  const rewrites: Array<{ slug: string; term: string; ok: boolean; error?: string; costCents?: number }> = []
  for (const item of ranking.underperformers) {
    if (Date.now() - t0 > BUDGET_MS) {
      rewrites.push({ slug: item.slug, term: item.term, ok: false, error: 'budget exhausted — re-run to continue' })
      break
    }
    try {
      const generated = await generateGlossaryEntry(item.term, { database, research: true })
      // Generation only — publishing remains a separate explicit call so
      // Liam can review the diff before it replaces a live page.
      rewrites.push({ slug: item.slug, term: item.term, ok: true, costCents: generated.totalCostCents })
    } catch (err) {
      rewrites.push({
        slug: item.slug, term: item.term, ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      })
    }
  }

  return NextResponse.json({
    mode: 'rewritten',
    scanned: ranking.scanned,
    rewriteCount: rewrites.length,
    rewrites,
    note: 'Tier 3 generated content for each underperformer. Review + publish each via /api/admin/content/glossary/publish with existingItemId.',
    durationMs: Date.now() - t0,
  })
}
