/**
 * POST /api/admin/cron/publish-scheduled
 *
 * Phase I · Slice 5. Runs every 15 minutes. Finds content_drafts that
 * have been staged in Webflow (publishedWebflowItemId set) and whose
 * scheduledFor has arrived (or passed) but haven't been flipped live
 * yet (publishedAt IS NULL). Promotes each staged item via Webflow's
 * publish endpoint + best-effort IndexNow ping.
 *
 * DISABLED BY DEFAULT. Master toggle: setting key
 * `content.publishCronEnabled = 'true'`. Until Liam wants un-attended
 * publish, he runs this manually from /settings/crons or stays with
 * pure "publish now" / "custom date triggered by me" flows.
 *
 * Auth: TAHI_CRON_SECRET or admin session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNull, isNotNull, lte } from 'drizzle-orm'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'
import {
  getBlogPostsCollectionId,
  publishCollectionItems,
} from '@/lib/webflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function readSetting(
  database: Awaited<ReturnType<typeof db>>,
  key: string,
): Promise<string | null> {
  const [row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  return row?.value ?? null
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'

  type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const database = await db() as unknown as D1
  const realDb = database as unknown as Awaited<ReturnType<typeof db>>

  if (!force) {
    const enabled = await readSetting(realDb, 'content.publishCronEnabled')
    if (enabled !== 'true') {
      const summary = { skipped: 'content.publishCronEnabled is not true' }
      await logCronRun(database, 'publish-scheduled', 'skipped', Date.now() - t0, summary, null)
      return NextResponse.json(summary)
    }
  }

  const nowIso = new Date().toISOString()

  // Candidates: scheduledFor has arrived AND we have a Webflow item id
  // staged AND nothing's published it yet.
  const due = await realDb
    .select({
      id: schema.contentDrafts.id,
      ideaId: schema.contentDrafts.ideaId,
      webflowItemId: schema.contentDrafts.publishedWebflowItemId,
      scheduledFor: schema.contentDrafts.scheduledFor,
      publishUrl: schema.contentDrafts.publishUrl,
    })
    .from(schema.contentDrafts)
    .where(and(
      isNotNull(schema.contentDrafts.publishedWebflowItemId),
      isNotNull(schema.contentDrafts.scheduledFor),
      isNull(schema.contentDrafts.publishedAt),
      lte(schema.contentDrafts.scheduledFor, nowIso),
    ))
    .limit(10)

  if (due.length === 0) {
    const summary = { published: 0, due: 0 }
    await logCronRun(database, 'publish-scheduled', 'success', Date.now() - t0, summary, null)
    return NextResponse.json(summary)
  }

  let collectionId: string
  try {
    collectionId = await getBlogPostsCollectionId()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logCronRun(database, 'publish-scheduled', 'error', Date.now() - t0, { due: due.length }, message)
    return NextResponse.json({ error: 'Webflow collection lookup failed', detail: message }, { status: 503 })
  }

  const results: Array<{ draftId: string; webflowItemId: string; ok: boolean; error?: string }> = []
  for (const row of due) {
    if (!row.webflowItemId) continue
    try {
      await publishCollectionItems(collectionId, [row.webflowItemId])
      const publishedAtIso = new Date().toISOString()
      await realDb
        .update(schema.contentDrafts)
        .set({
          publishedAt: publishedAtIso,
          updatedAt: publishedAtIso,
        })
        .where(eq(schema.contentDrafts.id, row.id))

      // Enqueue back-link job now that the post is genuinely LIVE.
      try {
        const slug = (row.publishUrl ?? '').split('/').pop() ?? ''
        if (slug && row.publishUrl) {
          await realDb.insert(schema.backlinkQueue).values({
            id: crypto.randomUUID(),
            newPostUrl: row.publishUrl,
            newPostSlug: slug,
            newPostWebflowId: row.webflowItemId,
            status: 'queued',
            attempts: 0,
            createdAt: publishedAtIso,
          })
        }
      } catch (err) {
        console.error('back-link enqueue (scheduled) failed', err)
      }

      // Seed this just-flipped-live post into site_index so the next
      // publish's glossary/related/back-link discovery already has it.
      try {
        if (row.publishUrl) {
          const { upsertSiteIndexEntry } = await import('@/lib/site-index')
          void upsertSiteIndexEntry(realDb, row.publishUrl)
        }
      } catch (err) {
        console.error('site-index upsert (scheduled) failed', err)
      }
      await realDb
        .update(schema.contentIdeas)
        .set({ status: 'published', updatedAt: publishedAtIso })
        .where(eq(schema.contentIdeas.id, row.ideaId))

      // Best-effort IndexNow ping. Same fire-and-forget pattern as the
      // manual publish route — we don't want IndexNow downtime to make
      // the cron's status look red.
      if (row.publishUrl) {
        try {
          const origin = new URL(req.url).origin
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
          if (cronSecret) headers['x-cron-secret'] = cronSecret
          void fetch(`${origin}/api/admin/content/health/indexnow`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ urls: [row.publishUrl] }),
          }).catch(() => undefined)
        } catch {
          // swallow
        }
      }

      results.push({ draftId: row.id, webflowItemId: row.webflowItemId, ok: true })
    } catch (err) {
      results.push({
        draftId: row.id,
        webflowItemId: row.webflowItemId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const summary = {
    due: due.length,
    published: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  }
  await logCronRun(database, 'publish-scheduled', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
