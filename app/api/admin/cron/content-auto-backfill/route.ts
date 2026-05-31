/**
 * POST /api/admin/cron/content-auto-backfill
 *
 * Weekly maintenance cron. When `content.autoBackfillEnabled` is true,
 * walks every glossary + blog item and re-runs the backfill on any
 * whose schema is missing or invalid. Body rewrites are only applied
 * when `content.autoRewriteBody` is also true.
 *
 * Auth: TAHI_CRON_SECRET header (matches the other crons).
 *
 * Time-bounded — processes up to 30 items per tick. Schedule weekly,
 * so even with 200 items the queue drains in ~7 weeks (or as items
 * become invalid). Run on demand via the Backfill tab's "Run on
 * everything" for big sweeps.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { inArray } from 'drizzle-orm'
import {
  listCollectionItems, getBlogPostsCollectionId, getGlossaryCollectionId,
} from '@/lib/webflow'
import { validateJsonLd } from '@/lib/schema-validate'
import { backfillGlossaryItem } from '@/lib/glossary-backfill'
import { backfillPost } from '@/lib/post-backfill'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 30
const BUDGET_MS = 22_000
const PACE_MS = 1500

async function readFlags(database: Awaited<ReturnType<typeof db>>): Promise<{ enabled: boolean; rewriteBody: boolean }> {
  const rows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, ['content.autoBackfillEnabled', 'content.autoRewriteBody']))
  const get = (k: string) => rows.find(r => r.key === k)?.value
  return {
    enabled: get('content.autoBackfillEnabled') === 'true',
    rewriteBody: get('content.autoRewriteBody') === 'true',
  }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function POST(req: NextRequest) {
  const cronHeader = req.headers.get('x-cron-secret') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const startedAt = Date.now()
  const database = await db()
  const flags = await readFlags(database)
  if (!flags.enabled) {
    const summary = { skipped: 'autoBackfillEnabled is false' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'content-auto-backfill', 'skipped', Date.now() - startedAt, summary, null)
    return NextResponse.json(summary)
  }

  // Find broken items in both collections — broken = no schema OR
  // schema fails validation.
  const t0 = Date.now()
  const broken: Array<{ type: 'glossary' | 'blog'; id: string; collectionId: string }> = []

  try {
    const glossId = await getGlossaryCollectionId()
    let offset = 0
    while (Date.now() - t0 < 5_000) {
      const page = await listCollectionItems(glossId, { offset, limit: 100 })
      if (page.items.length === 0) break
      for (const it of page.items) {
        const s = (it.fieldData as { schema?: string }).schema ?? ''
        if (!s || !validateJsonLd(s).valid) broken.push({ type: 'glossary', id: it.id, collectionId: glossId })
      }
      if (page.items.length < 100) break
      offset += page.items.length
    }
  } catch (err) {
    console.error('auto-backfill glossary scan failed', err)
  }

  try {
    const blogId = await getBlogPostsCollectionId()
    let offset = 0
    while (Date.now() - t0 < 10_000) {
      const page = await listCollectionItems(blogId, { offset, limit: 100 })
      if (page.items.length === 0) break
      for (const it of page.items) {
        const s = (it.fieldData as { schema?: string }).schema ?? ''
        if (!s || !validateJsonLd(s).valid) broken.push({ type: 'blog', id: it.id, collectionId: blogId })
      }
      if (page.items.length < 100) break
      offset += page.items.length
    }
  } catch (err) {
    console.error('auto-backfill blog scan failed', err)
  }

  // Process up to MAX_ITEMS within remaining budget.
  let processed = 0
  let patched = 0
  let errors = 0
  for (const target of broken) {
    if (processed >= MAX_ITEMS) break
    if (Date.now() - startedAt > BUDGET_MS) break
    try {
      const result = target.type === 'glossary'
        ? await backfillGlossaryItem(target.collectionId, target.id, { dryRun: false, rewriteBody: flags.rewriteBody })
        : await backfillPost(target.collectionId, target.id, { dryRun: false, rewriteBody: flags.rewriteBody })
      processed++
      if (result.patched) patched++
    } catch (err) {
      errors++
      console.error('auto-backfill item failed', target.id, err)
    }
    await sleep(PACE_MS)
  }

  const summary = {
    brokenFound: broken.length,
    processed,
    patched,
    errors,
    remaining: Math.max(0, broken.length - processed),
    durationMs: Date.now() - startedAt,
  }
  await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'content-auto-backfill', errors > 0 ? 'error' : 'success', summary.durationMs, summary, null)
  return NextResponse.json(summary)
}
