/**
 * POST /api/admin/cron/link-engine-scan
 *
 * Phase I · Slice 6 — weekly internal-link engine scan.
 *
 * Pulls every blog post from Webflow, finds posts published in the
 * last 14 days that have fewer than 3 inbound internal links, and
 * proposes patches (with confidence + diff context) to bring fresh
 * content above the in-week link-velocity threshold.
 *
 * Disabled by default. Toggle via the `content.linkEngineEnabled`
 * setting in Settings → Content engine. The manual "Run now" button
 * on /settings/crons passes ?force=1 to bypass.
 *
 * Auth: TAHI_CRON_SECRET header OR admin session. Schedule: Monday
 * 09:00 UK (registered but disabled — wired into wrangler crons only
 * after Liam flips the setting).
 *
 * Output (also persisted via cron_runs.summary):
 *   { targetsScanned, suggestionsCreated, skippedAlreadyOk, errors,
 *     skipped?: 'content.linkEngineEnabled is not true' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, lt, like, sql } from 'drizzle-orm'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'
import { listCollectionItems, type WebflowCollectionItem } from '@/lib/webflow'
import {
  analyseLinkOpportunities,
  bodyLinksTo,
  extractTargetPhrases,
} from '@/lib/link-analyzer'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const WEBFLOW_PAGE_SIZE = 100

interface CmsPost {
  webflowId: string
  url: string
  title: string
  bodyHtml: string
  publishedAt: string | null
  metaTitle: string | null
  metaDescription: string | null
}

function readField(item: WebflowCollectionItem, key: string): string | null {
  const v = item.fieldData[key]
  if (v == null) return null
  return String(v)
}

async function listAllPosts(): Promise<CmsPost[]> {
  const out: CmsPost[] = []
  let offset = 0
  for (let i = 0; i < 10; i++) {
    const { items, total } = await listCollectionItems(BLOG_POSTS_COLLECTION_ID, {
      limit: WEBFLOW_PAGE_SIZE,
      offset,
    })
    for (const it of items) {
      const slug = readField(it, 'slug') ?? ''
      if (!slug) continue
      out.push({
        webflowId: it.id,
        url: `https://www.tahi.studio/blog/${slug}`,
        title: readField(it, 'name') ?? slug,
        bodyHtml: readField(it, 'post-body') ?? '',
        publishedAt: it.lastPublished ?? readField(it, 'published-on') ?? null,
        metaTitle: readField(it, 'meta-title'),
        metaDescription: readField(it, 'meta-description-2'),
      })
    }
    if (items.length < WEBFLOW_PAGE_SIZE) break
    offset += items.length
    if (offset >= total) break
  }
  return out
}

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
  const body = (await req.json().catch(() => ({}))) as { force?: boolean }
  const bypassEnabled = force || body.force === true

  const database = await db()

  if (!bypassEnabled) {
    const enabled = await readSetting(database, 'content.linkEngineEnabled')
    if (enabled !== 'true') {
      const summary = { skipped: 'content.linkEngineEnabled is not true' }
      await logCronRun(
        database as unknown as Parameters<typeof logCronRun>[0],
        'link-engine-scan',
        'skipped',
        Date.now() - t0,
        summary,
        null,
      )
      return NextResponse.json(summary)
    }
  }

  let allPosts: CmsPost[]
  try {
    allPosts = await listAllPosts()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logCronRun(
      database as unknown as Parameters<typeof logCronRun>[0],
      'link-engine-scan',
      'error',
      Date.now() - t0,
      null,
      `listCollectionItems failed: ${message}`,
    )
    return NextResponse.json({ error: 'Failed to load posts from Webflow', detail: message }, { status: 502 })
  }

  // Pick targets: posts published in the last 14 days.
  const cutoff = Date.now() - 14 * 86_400_000
  const fresh = allPosts.filter(p => {
    if (!p.publishedAt) return false
    const t = Date.parse(p.publishedAt)
    return !Number.isNaN(t) && t >= cutoff
  })

  let targets = fresh
  // Also include any blog_health row flagged as < 3 inbound links so
  // older posts that were never properly linked don't get stranded.
  try {
    const flagged = await database
      .select({ url: schema.blogHealth.url })
      .from(schema.blogHealth)
      .where(and(
        like(schema.blogHealth.url, 'https://www.tahi.studio/blog/%'),
        lt(schema.blogHealth.inboundInternalLinks, 3),
        sql`${schema.blogHealth.lastCheckedAt} > ${new Date(cutoff).toISOString()}`,
      ))
    const flaggedUrls = new Set(flagged.map(f => f.url))
    const merged = new Map<string, CmsPost>()
    for (const p of fresh) merged.set(p.url, p)
    for (const p of allPosts) if (flaggedUrls.has(p.url)) merged.set(p.url, p)
    targets = Array.from(merged.values())
  } catch {
    // Stick with the fresh-only list if blog_health is empty / errors.
  }

  let suggestionsCreated = 0
  let skippedAlreadyOk = 0
  const errors: Array<{ url: string; error: string }> = []
  const nowIso = new Date().toISOString()

  for (const target of targets) {
    try {
      const existing = new Set<string>()
      for (const post of allPosts) {
        if (post.webflowId === target.webflowId) continue
        if (bodyLinksTo(post.bodyHtml, target.url)) existing.add(post.webflowId)
      }
      if (existing.size >= 3) {
        skippedAlreadyOk++
        continue
      }

      const { topics, keywords } = extractTargetPhrases({
        title: target.title,
        bodyHtml: target.bodyHtml,
        metaTitle: target.metaTitle,
        metaDescription: target.metaDescription,
      })

      const suggestions = analyseLinkOpportunities({
        newPost: {
          url: target.url,
          title: target.title,
          publishedAt: target.publishedAt ?? nowIso,
          topics,
          keywords,
        },
        oldPosts: allPosts.map(p => ({
          webflowId: p.webflowId,
          url: p.url,
          title: p.title,
          bodyHtml: p.bodyHtml,
          publishedAt: p.publishedAt,
        })),
        existingInboundLinkSources: existing,
      })

      await database.delete(schema.linkSuggestions).where(and(
        eq(schema.linkSuggestions.targetUrl, target.url),
        eq(schema.linkSuggestions.status, 'pending'),
      ))

      for (const s of suggestions) {
        await database.insert(schema.linkSuggestions).values({
          id: crypto.randomUUID(),
          targetUrl: target.url,
          targetTitle: target.title,
          targetPublishedAt: target.publishedAt,
          sourceWebflowId: s.sourceWebflowId,
          sourceUrl: s.sourceUrl,
          sourceTitle: s.sourceTitle,
          matchPhrase: s.matchPhrase,
          contextBefore: s.contextBefore,
          contextAfter: s.contextAfter,
          proposedAnchorText: s.proposedAnchorText,
          justification: s.justification,
          confidence: s.confidence,
          status: 'pending',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        suggestionsCreated++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`link-engine-scan failed for ${target.url}`, err)
      errors.push({ url: target.url, error: message })
    }
  }

  const summary = {
    targetsScanned: targets.length,
    suggestionsCreated,
    skippedAlreadyOk,
    errors: errors.length,
    errorDetails: errors.slice(0, 20),
    completedAt: new Date().toISOString(),
  }
  await logCronRun(
    database as unknown as Parameters<typeof logCronRun>[0],
    'link-engine-scan',
    'success',
    Date.now() - t0,
    summary,
    null,
  )
  return NextResponse.json(summary)
}
