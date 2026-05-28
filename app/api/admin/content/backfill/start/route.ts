/**
 * POST /api/admin/content/backfill/start
 *
 * Phase I · Slice 6.5 — kick off a backfill run over the existing Tahi
 * blog posts. This route does NOT do any work itself — it allocates a
 * `runId`, lists the items, applies the mode filter, and returns the
 * list of Webflow item ids the caller should walk via repeated calls to
 * /api/admin/content/backfill/process.
 *
 * Cloudflare Workers `waitUntil` is finite + we want UI progress, so the
 * caller-driven batching pattern wins over fire-and-forget background
 * jobs. The UI POSTs to /process with batchSize items at a time and
 * shows progress between calls.
 *
 * Modes:
 *   'all'         — process every blog post
 *   'missing'     — only posts where FAQ Question #1 is empty (resumable)
 *   'webflowIds'  — process the exact ids passed in `webflowIds`
 *
 * Contract:
 *   POST body: { mode?: 'all' | 'missing' | 'webflowIds', webflowIds?: string[] }
 *   200: { runId: string, totalToProcess: number, webflowIds: string[], mode: string }
 *   400: { error } on bad input
 *   500: { error } on Webflow listing failure
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { listCollectionItems, type WebflowCollectionItem } from '@/lib/webflow'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const WEBFLOW_PAGE_SIZE = 100

type Mode = 'all' | 'missing' | 'webflowIds'

interface StartBody {
  mode?: Mode
  webflowIds?: string[]
}

async function listAllItems(): Promise<WebflowCollectionItem[]> {
  const out: WebflowCollectionItem[] = []
  let offset = 0
  // Safety cap at 10 pages = 1000 items. Tahi has ~57 today.
  for (let i = 0; i < 10; i++) {
    const { items, total } = await listCollectionItems(BLOG_POSTS_COLLECTION_ID, {
      limit: WEBFLOW_PAGE_SIZE,
      offset,
    })
    for (const it of items) out.push(it)
    if (items.length < WEBFLOW_PAGE_SIZE) break
    offset += items.length
    if (offset >= total) break
  }
  return out
}

/** "missing" mode filter — keeps items whose FAQ Question #1 slot is
 *  empty / absent. This is a resumable signal: items we've already
 *  backfilled get skipped on subsequent runs. */
function hasFaqOne(item: WebflowCollectionItem): boolean {
  const fd = item.fieldData as { 'faq-question-1'?: string }
  const q1 = fd['faq-question-1']
  return typeof q1 === 'string' && q1.trim().length > 0
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as StartBody
  const mode: Mode = body.mode ?? 'all'

  if (mode !== 'all' && mode !== 'missing' && mode !== 'webflowIds') {
    return NextResponse.json({
      error: `Invalid mode "${mode}". Must be 'all' | 'missing' | 'webflowIds'.`,
    }, { status: 400 })
  }

  if (mode === 'webflowIds') {
    const ids = Array.isArray(body.webflowIds)
      ? body.webflowIds.filter(s => typeof s === 'string' && s.length > 0)
      : []
    if (ids.length === 0) {
      return NextResponse.json({
        error: 'mode=webflowIds requires a non-empty webflowIds array',
      }, { status: 400 })
    }
    return NextResponse.json({
      runId: crypto.randomUUID(),
      mode,
      totalToProcess: ids.length,
      webflowIds: ids,
    })
  }

  let items: WebflowCollectionItem[]
  try {
    items = await listAllItems()
  } catch (err) {
    console.error('backfill/start: failed to list Webflow items', err)
    return NextResponse.json({
      error: 'Failed to list Webflow collection items',
    }, { status: 500 })
  }

  const filtered = mode === 'missing'
    ? items.filter(it => !hasFaqOne(it))
    : items

  return NextResponse.json({
    runId: crypto.randomUUID(),
    mode,
    totalToProcess: filtered.length,
    webflowIds: filtered.map(it => it.id),
  })
}
