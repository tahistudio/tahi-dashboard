/**
 * POST /api/admin/content/bulk-backfill
 *
 * Runs the backfill across glossary + blog posts in one Worker tick.
 * Respects Webflow's ~60 req/min cap (we pace at 40/min to leave
 * headroom). Resumable via the returned cursor — if the runner hits
 * the time budget, it returns { cursor: { type, offset } } and the
 * caller fires the same endpoint again with the cursor to continue.
 *
 * Body: {
 *   type?: 'blog' | 'glossary' | 'all'   (default: all)
 *   dryRun?: boolean                      (default: false)
 *   rewriteBody?: boolean                 (default: false)
 *   cursor?: { type: 'blog'|'glossary', offset: number }
 *   maxItemsPerRun?: number               (default: 60 — comfortable inside 30s budget)
 * }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listCollectionItems, getBlogPostsCollectionId, getGlossaryCollectionId,
} from '@/lib/webflow'
import { backfillGlossaryItem, type GlossaryBackfillResult } from '@/lib/glossary-backfill'
import { backfillPost, type PostBackfillResult } from '@/lib/post-backfill'

export const dynamic = 'force-dynamic'

interface Body {
  type?: 'blog' | 'glossary' | 'all'
  dryRun?: boolean
  rewriteBody?: boolean
  cursor?: { type: 'blog' | 'glossary'; offset: number }
  maxItemsPerRun?: number
}

const TICK_BUDGET_MS = 22_000 // Worker has ~30s; leave headroom for setup + response
const PACE_MS = 1500          // ~40 requests/min, safely under Webflow's 60/min cap

interface RunSummary {
  processed: number
  patched: number
  schemaFixed: number
  errors: number
  results: Array<{ itemId: string; slug: string; ok: boolean; error?: string }>
  cursor: { type: 'blog' | 'glossary'; offset: number } | null
  durationMs: number
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Body
  const type = body.type ?? 'all'
  const dryRun = !!body.dryRun
  const rewriteBody = !!body.rewriteBody
  const maxItemsPerRun = Math.max(1, Math.min(200, body.maxItemsPerRun ?? 60))
  const t0 = Date.now()

  const summary: RunSummary = {
    processed: 0, patched: 0, schemaFixed: 0, errors: 0,
    results: [], cursor: null, durationMs: 0,
  }

  // Resume from cursor if provided.
  const startType: 'blog' | 'glossary' = body.cursor?.type ?? (type === 'glossary' ? 'glossary' : 'blog')
  let offset = body.cursor?.offset ?? 0

  // Process glossary first (lower-risk, schema-only is non-destructive),
  // then blog. If type is restricted, only that branch runs.
  const phases: Array<'blog' | 'glossary'> = []
  if (type === 'all') {
    // Start from whichever phase the cursor points at.
    phases.push(startType)
    if (startType === 'blog') phases.push('glossary')
    else phases.push('blog')
  } else {
    phases.push(type)
  }

  for (const phase of phases) {
    if (Date.now() - t0 > TICK_BUDGET_MS) {
      summary.cursor = { type: phase, offset }
      break
    }
    if (summary.processed >= maxItemsPerRun) {
      summary.cursor = { type: phase, offset }
      break
    }

    const collectionId = phase === 'blog'
      ? await getBlogPostsCollectionId()
      : await getGlossaryCollectionId()

    // Walk this collection from `offset` until budget or cap.
    while (true) {
      if (Date.now() - t0 > TICK_BUDGET_MS || summary.processed >= maxItemsPerRun) {
        summary.cursor = { type: phase, offset }
        return finish(summary, t0)
      }
      const page = await listCollectionItems(collectionId, { offset, limit: 20 })
      if (page.items.length === 0) {
        // Phase done — reset offset for next phase if continuing.
        offset = 0
        break
      }
      for (const it of page.items) {
        if (Date.now() - t0 > TICK_BUDGET_MS || summary.processed >= maxItemsPerRun) {
          summary.cursor = { type: phase, offset }
          return finish(summary, t0)
        }
        try {
          let r: GlossaryBackfillResult | PostBackfillResult
          if (phase === 'glossary') {
            r = await backfillGlossaryItem(collectionId, it.id, { dryRun, rewriteBody })
          } else {
            r = await backfillPost(collectionId, it.id, { dryRun, rewriteBody })
          }
          summary.processed++
          if (r.patched) summary.patched++
          // schemaFixed = had errors before, none after
          if (r.schemaErrorsBefore > 0 && r.schemaErrorsAfter === 0) summary.schemaFixed++
          summary.results.push({ itemId: r.itemId, slug: r.slug, ok: true })
        } catch (err) {
          summary.errors++
          summary.results.push({
            itemId: it.id,
            slug: (it.fieldData?.slug as string | undefined) ?? '',
            ok: false,
            error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
          })
        }
        offset++
        // Pace: stay under Webflow's rate cap. Backfill makes 2-3
        // patches per item so 1.5s/item ≈ 40-80 req/min.
        await sleep(PACE_MS)
      }
    }
  }

  return finish(summary, t0)
}

function finish(s: RunSummary, t0: number): NextResponse {
  s.durationMs = Date.now() - t0
  return NextResponse.json(s)
}
