/**
 * POST /api/admin/content/backfill/process
 *
 * Phase I · Slice 6.5 — process one batch of items in a backfill run.
 * The /start route returns the runId + webflowIds; the caller (UI) walks
 * the list batch-by-batch by re-posting here with an incremented
 * continueFromIndex until completed=true.
 *
 * Per-item flow:
 *   1. GET the item from Webflow
 *   2. backfillPostFields(input) — Sonnet call + schema + hreflang
 *   3. PATCH the new fields onto the item (staged edit, never publish)
 *   4. INSERT a blog_backfill_log row
 *
 * Rate limiting: items are processed serially inside the batch so we
 * don't hammer Anthropic + Webflow. Caller is expected to pause ~1s
 * between batches to stay well under Webflow's 60 req/min limit (each
 * item burns 2 calls: GET + PATCH).
 *
 * Staged edits only — we never call publishCollectionItems. Liam batch-
 * publishes from the Webflow Editor after spot-checking.
 *
 * Contract:
 *   POST body: {
 *     runId: string,
 *     webflowIds: string[],
 *     continueFromIndex?: number,  // default 0
 *     batchSize?: number,          // default 5, max 10
 *   }
 *   200: {
 *     processed: number,
 *     succeeded: number,
 *     failed: number,
 *     skipped: number,
 *     items: Array<{ id, slug?, status, error?, fieldsWritten: string[] }>,
 *     continueFromIndex?: number,  // present when more work remains
 *     completed: boolean,
 *   }
 *   400 / 500 with { error } on validation / top-level failure.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getCollectionItem, patchCollectionItem } from '@/lib/webflow'
import {
  backfillPostFields,
  buildWebflowPatchPayload,
  type BackfillPostInput,
} from '@/lib/blog-backfill'
import type { BlogPostFields } from '@/lib/blog-schema-input'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const DEFAULT_BATCH_SIZE = 5
const MAX_BATCH_SIZE = 10

interface ProcessBody {
  runId?: string
  webflowIds?: string[]
  continueFromIndex?: number
  batchSize?: number
}

interface ProcessItemResult {
  id: string
  slug?: string
  status: 'success' | 'failed' | 'skipped'
  error?: string
  fieldsWritten: string[]
}

function categoryName(v: BlogPostFields['main-category']): string | null {
  if (!v) return null
  if (typeof v === 'string') {
    // Webflow returns reference fields as bare item ids. We don't have
    // a reverse-lookup table here; the string still flows through to
    // the schema generator as `mainCategory` which uses it for keywords
    // + articleSection. This matches Slice 3 behaviour.
    return v
  }
  return v.name ?? null
}

function authorName(v: BlogPostFields['author']): string | null {
  if (!v) return null
  if (typeof v === 'string') return null  // reference id, can't resolve here
  return v.name ?? null
}

async function processOne(
  itemId: string,
  runId: string,
): Promise<ProcessItemResult & { logRow: typeof schema.blogBackfillLog.$inferInsert }> {
  const startMs = Date.now()
  const baseLog = {
    id: crypto.randomUUID(),
    webflowItemId: itemId,
    postUrl: '',
    postTitle: null as string | null,
    runId,
    status: 'failed' as 'success' | 'failed' | 'skipped',
    fieldsWritten: null as string | null,
    errorMessage: null as string | null,
    faqsGenerated: null as number | null,
    takeawaysGenerated: null as number | null,
    schemaCharsWritten: null as number | null,
    durationMs: null as number | null,
  }

  let slug = ''
  let postUrl = ''
  let title = ''

  try {
    // 1) Fetch existing Webflow item.
    const item = await getCollectionItem(BLOG_POSTS_COLLECTION_ID, itemId)
    const f = item.fieldData as BlogPostFields
    slug = (f.slug ?? '').trim()
    postUrl = `https://www.tahi.studio/blog/${slug}`
    title = (f['meta-title'] ?? f.name ?? '').trim()

    if (!title || !f['post-body']) {
      // Missing fields we can't run without — log as skipped, don't
      // burn an Anthropic call.
      const logRow = {
        ...baseLog,
        postUrl,
        postTitle: title || null,
        status: 'skipped' as const,
        errorMessage: !title ? 'Missing title' : 'Missing body',
        durationMs: Date.now() - startMs,
      }
      return {
        id: itemId,
        slug,
        status: 'skipped',
        error: logRow.errorMessage,
        fieldsWritten: [],
        logRow,
      }
    }

    // 2) Run the orchestrator. Generates FAQs / takeaways / AI prompt
    //    via Sonnet + builds the schema + hreflang via pure helpers.
    const input: BackfillPostInput = {
      webflowItemId: itemId,
      postUrl,
      title,
      bodyHtml: f['post-body'],
      metaDescription: (f['meta-description-2'] ?? f['post-description'] ?? f['summary-2'] ?? null),
      publishedAt: f['published-on'] ?? null,
      authorName: authorName(f.author),
      mainCategoryName: categoryName(f['main-category']),
    }
    const out = await backfillPostFields(input)
    const payload = buildWebflowPatchPayload(out)
    const writtenSlugs = Object.keys(payload)

    // 3) PATCH all new fields in a single Webflow call. Webflow only
    //    updates the fields we pass; everything else (body, title,
    //    slug, images, categories, author, related posts) is left
    //    untouched. Edit lands STAGED.
    await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, itemId, payload)

    const logRow = {
      ...baseLog,
      postUrl,
      postTitle: title,
      status: 'success' as const,
      fieldsWritten: JSON.stringify(writtenSlugs),
      faqsGenerated: out.faqs.length,
      takeawaysGenerated: out.keyTakeawaysHtml.match(/<li/gi)?.length ?? 0,
      schemaCharsWritten: out.schemaJsonLd.length,
      durationMs: Date.now() - startMs,
    }
    return {
      id: itemId,
      slug,
      status: 'success',
      fieldsWritten: writtenSlugs,
      logRow,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
    const logRow = {
      ...baseLog,
      postUrl,
      postTitle: title || null,
      status: 'failed' as const,
      errorMessage: message,
      durationMs: Date.now() - startMs,
    }
    return {
      id: itemId,
      slug: slug || undefined,
      status: 'failed',
      error: message,
      fieldsWritten: [],
      logRow,
    }
  }
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as ProcessBody

  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }

  const ids = Array.isArray(body.webflowIds)
    ? body.webflowIds.filter(s => typeof s === 'string' && s.length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'webflowIds must be a non-empty array' }, { status: 400 })
  }

  const startIdx = Math.max(0, Math.floor(body.continueFromIndex ?? 0))
  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(1, Math.floor(body.batchSize ?? DEFAULT_BATCH_SIZE)),
  )

  if (startIdx >= ids.length) {
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      items: [],
      completed: true,
    })
  }

  const slice = ids.slice(startIdx, startIdx + batchSize)
  const database = await db()

  // Process items serially. The Anthropic + Webflow calls dominate the
  // wall-clock cost; serial keeps the worker well under any concurrent
  // request cap and gives us a clean ordering for the log table.
  const results: ProcessItemResult[] = []
  for (const id of slice) {
    const result = await processOne(id, runId)
    results.push({
      id: result.id,
      slug: result.slug,
      status: result.status,
      error: result.error,
      fieldsWritten: result.fieldsWritten,
    })
    try {
      await database.insert(schema.blogBackfillLog).values(result.logRow)
    } catch (err) {
      console.error('backfill/process: failed to write log row', err)
      // Don't fail the batch on log write — the item was already patched.
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length
  const failed = results.filter(r => r.status === 'failed').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const nextIndex = startIdx + slice.length
  const completed = nextIndex >= ids.length

  return NextResponse.json({
    processed: slice.length,
    succeeded,
    failed,
    skipped,
    items: results,
    ...(completed ? {} : { continueFromIndex: nextIndex }),
    completed,
  })
}
