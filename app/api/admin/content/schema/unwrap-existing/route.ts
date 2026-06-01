/**
 * POST /api/admin/content/schema/unwrap-existing
 *
 * One-shot helper: walks Blog Posts + Glossary items, finds any
 * `schema` field that's wrapped in <script type="application/ld+json">,
 * strips the wrapper, patches the bare JSON back. Liam's Webflow
 * template now adds the <script> tag at render time, so the stored
 * value must NOT include the wrapper.
 *
 * Cheaper than re-running bulk-backfill — does a regex strip, not a
 * full regeneration. Safe to re-run; items already unwrapped get
 * skipped.
 *
 * Body: { type?: 'blog' | 'glossary' | 'all', dryRun?: boolean }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listCollectionItems, patchCollectionItem,
  getBlogPostsCollectionId, getGlossaryCollectionId,
} from '@/lib/webflow'

export const dynamic = 'force-dynamic'

const BUDGET_MS = 22_000
const BATCH_CONCURRENCY = 6   // parallel patches per batch
const INTER_BATCH_MS = 1000   // sleep between batches to respect Webflow's 60 req/min cap

interface Body {
  type?: 'blog' | 'glossary' | 'all'
  dryRun?: boolean
}

const SCRIPT_OPEN_RE = /^\s*<script[^>]*type=["']application\/ld\+json["'][^>]*>/i
const SCRIPT_CLOSE_RE = /<\/script>\s*$/i

function stripWrapper(schemaStr: string): { unwrapped: string; changed: boolean } {
  if (!schemaStr) return { unwrapped: schemaStr, changed: false }
  const hadOpen = SCRIPT_OPEN_RE.test(schemaStr)
  const hadClose = SCRIPT_CLOSE_RE.test(schemaStr)
  if (!hadOpen && !hadClose) return { unwrapped: schemaStr, changed: false }
  const unwrapped = schemaStr
    .replace(SCRIPT_OPEN_RE, '')
    .replace(SCRIPT_CLOSE_RE, '')
    .trim()
  // Sanity check: the result should parse as JSON. If it doesn't, the
  // schema is malformed in some other way — leave it alone so a human
  // can look at it rather than save broken data.
  try { JSON.parse(unwrapped) }
  catch { return { unwrapped: schemaStr, changed: false } }
  return { unwrapped, changed: true }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function processCollection(
  collectionId: string,
  budgetMs: number,
  t0: number,
  dryRun: boolean,
): Promise<{ scanned: number; alreadyClean: number; unwrapped: number; failed: number; samples: string[] }> {
  let scanned = 0
  let alreadyClean = 0
  let unwrapped = 0
  let failed = 0
  const samples: string[] = []
  let offset = 0

  // Pre-compute "needs patch" items per page, then patch in parallel
  // batches of BATCH_CONCURRENCY. Webflow's API rate limit is 60
  // req/min — at 6 patches per batch + 1s sleep we average ~36 req/min,
  // safely under the cap. Throughput is ~6x what the old sequential
  // 1.2s-per-item loop managed, so a full 145-URL site drains in 1-2
  // ticks instead of needing 8-10.
  while (Date.now() - t0 < budgetMs) {
    const page = await listCollectionItems(collectionId, { offset, limit: 100 })
    if (page.items.length === 0) break

    // First pass: figure out which items need patching (cheap, in-memory).
    const toPatch: Array<{ id: string; slug: string; unwrapped: string }> = []
    for (const it of page.items) {
      scanned++
      const f = it.fieldData as { schema?: string; slug?: string }
      const result = stripWrapper(f.schema ?? '')
      if (!result.changed) { alreadyClean++; continue }
      toPatch.push({ id: it.id, slug: f.slug ?? it.id, unwrapped: result.unwrapped })
    }

    // Second pass: parallel-patch in batches with rate-limit pacing.
    for (let i = 0; i < toPatch.length; i += BATCH_CONCURRENCY) {
      if (Date.now() - t0 > budgetMs) break
      const batch = toPatch.slice(i, i + BATCH_CONCURRENCY)
      if (dryRun) {
        for (const item of batch) {
          unwrapped++
          if (samples.length < 5) samples.push(item.slug)
        }
        continue
      }
      const results = await Promise.allSettled(batch.map(item =>
        patchCollectionItem(collectionId, item.id, { schema: item.unwrapped })
      ))
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        const item = batch[j]
        if (r.status === 'fulfilled') {
          unwrapped++
          if (samples.length < 5) samples.push(item.slug)
        } else {
          failed++
          console.error('unwrap patch failed', item.slug, r.reason instanceof Error ? r.reason.message : r.reason)
        }
      }
      // Sleep BETWEEN batches (not before the first one) so the next
      // batch lands inside Webflow's rate-limit window without burning
      // tick budget.
      if (i + BATCH_CONCURRENCY < toPatch.length && Date.now() - t0 < budgetMs) {
        await sleep(INTER_BATCH_MS)
      }
    }

    if (page.items.length < 100) break
    offset += page.items.length
  }
  return { scanned, alreadyClean, unwrapped, failed, samples }
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Body
  const type = body.type ?? 'all'
  const dryRun = !!body.dryRun
  const t0 = Date.now()

  const summary: {
    blog?: Awaited<ReturnType<typeof processCollection>>
    glossary?: Awaited<ReturnType<typeof processCollection>>
    dryRun: boolean
    durationMs: number
  } = { dryRun, durationMs: 0 }

  if (type === 'blog' || type === 'all') {
    try {
      const blogId = await getBlogPostsCollectionId()
      summary.blog = await processCollection(blogId, BUDGET_MS, t0, dryRun)
    } catch (err) {
      console.error('unwrap blog failed', err)
    }
  }
  if ((type === 'glossary' || type === 'all') && Date.now() - t0 < BUDGET_MS) {
    try {
      const glossId = await getGlossaryCollectionId()
      summary.glossary = await processCollection(glossId, BUDGET_MS, t0, dryRun)
    } catch (err) {
      console.error('unwrap glossary failed', err)
    }
  }
  summary.durationMs = Date.now() - t0
  return NextResponse.json(summary)
}
