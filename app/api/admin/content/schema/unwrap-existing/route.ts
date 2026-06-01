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
const PACE_MS = 1200

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
  while (Date.now() - t0 < budgetMs) {
    const page = await listCollectionItems(collectionId, { offset, limit: 100 })
    if (page.items.length === 0) break
    for (const it of page.items) {
      if (Date.now() - t0 > budgetMs) break
      scanned++
      const f = it.fieldData as { schema?: string; slug?: string }
      const result = stripWrapper(f.schema ?? '')
      if (!result.changed) { alreadyClean++; continue }
      if (dryRun) {
        unwrapped++
        if (samples.length < 5) samples.push(f.slug ?? it.id)
        continue
      }
      try {
        await patchCollectionItem(collectionId, it.id, { schema: result.unwrapped })
        unwrapped++
        if (samples.length < 5) samples.push(f.slug ?? it.id)
        await sleep(PACE_MS)
      } catch (err) {
        failed++
        console.error('unwrap patch failed', f.slug ?? it.id, err instanceof Error ? err.message : err)
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
