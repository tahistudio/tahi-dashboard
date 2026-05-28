/**
 * POST /api/admin/content/links/scan
 *
 * Phase I · Slice 6 — internal link engine scan.
 *
 * Computes patch suggestions for adding inbound internal links to
 * recently-published blog posts. Writes findings to `link_suggestions`
 * with status='pending' for Liam to review in the Links tab.
 *
 * Algorithm:
 *   1. Determine target posts:
 *      - If body.targetUrl is set, scan that one URL only.
 *      - Else, every blog_health row whose URL is /blog/* AND was last
 *        checked within the last 14 days AND has fewer than 3 inbound
 *        internal links. Falls back to "every blog URL with < 3 inbound
 *        links" when last_checked_at is stale, so a fresh repo still
 *        produces a useful first scan.
 *   2. Load every blog post via listCollectionItems().
 *   3. For each target:
 *      - Find existing inbound link sources by scanning every old body
 *        for links to target.url.
 *      - Extract topics + keywords from the target post.
 *      - Run analyseLinkOpportunities → write each suggestion as a
 *        pending row in link_suggestions.
 *      - Update blog_health.inbound_internal_links so the next scan
 *        skips this post if Liam applies enough patches.
 *
 * Important:
 *   - Re-running for the same target wipes the existing PENDING rows for
 *     that target first, so the slate refreshes. APPLIED + REJECTED rows
 *     are preserved (they're audit history).
 *   - We do NOT patch Webflow here. Apply happens in the apply route.
 *
 * Contract:
 *   POST body: { targetUrl?: string }
 *   200: {
 *     targetsScanned: number,
 *     suggestionsCreated: number,
 *     skippedAlreadyOk: number,
 *     errors: Array<{ url: string; error: string }>,
 *     completedAt: string,
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, lt, like, sql } from 'drizzle-orm'
import { listCollectionItems, type WebflowCollectionItem } from '@/lib/webflow'
import {
  analyseLinkOpportunities,
  bodyLinksTo,
  extractTargetPhrases,
  type LinkSuggestion,
} from '@/lib/link-analyzer'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const WEBFLOW_PAGE_SIZE = 100

interface ScanBody {
  targetUrl?: string
}

interface CmsPost {
  webflowId: string
  url: string
  title: string
  slug: string
  bodyHtml: string
  publishedAt: string | null
  metaTitle: string | null
  metaDescription: string | null
}

function readField<T = string>(item: WebflowCollectionItem, key: string): T | null {
  const v = item.fieldData[key]
  if (v == null) return null
  return v as T
}

function postUrlFromSlug(slug: string): string {
  return `https://www.tahi.studio/blog/${slug}`
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
      const slug = readField<string>(it, 'slug') ?? ''
      if (!slug) continue
      out.push({
        webflowId: it.id,
        url: postUrlFromSlug(slug),
        title: readField<string>(it, 'name') ?? slug,
        slug,
        bodyHtml: readField<string>(it, 'body') ?? '',
        publishedAt: it.lastPublished ?? readField<string>(it, 'published-on') ?? null,
        metaTitle: readField<string>(it, 'meta-title'),
        metaDescription: readField<string>(it, 'meta-description'),
      })
    }
    if (items.length < WEBFLOW_PAGE_SIZE) break
    offset += items.length
    if (offset >= total) break
  }
  return out
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as ScanBody
  const targetUrl = body.targetUrl?.trim() || null

  let allPosts: CmsPost[]
  try {
    allPosts = await listAllPosts()
  } catch (err) {
    console.error('listCollectionItems failed in links/scan', err)
    return NextResponse.json({
      error: 'Failed to load blog posts from Webflow',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  const database = await db()

  // Determine the target post set.
  const targets: CmsPost[] = []
  if (targetUrl) {
    const match = allPosts.find(p => p.url === targetUrl)
    if (!match) {
      return NextResponse.json({ error: `No blog post found for ${targetUrl}` }, { status: 404 })
    }
    targets.push(match)
  } else {
    // Pull every recently-checked blog_health row with < 3 inbound links
    // OR, if none qualify, fall back to every blog URL in the collection
    // (covers the "fresh repo" case before health scans have run).
    const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
    let candidates: Array<{ url: string }> = []
    try {
      candidates = await database
        .select({ url: schema.blogHealth.url })
        .from(schema.blogHealth)
        .where(and(
          like(schema.blogHealth.url, 'https://www.tahi.studio/blog/%'),
          sql`${schema.blogHealth.lastCheckedAt} > ${cutoff}`,
          lt(schema.blogHealth.inboundInternalLinks, 3),
        ))
    } catch {
      candidates = []
    }
    if (candidates.length === 0) {
      for (const p of allPosts) targets.push(p)
    } else {
      const urlSet = new Set(candidates.map(c => c.url))
      for (const p of allPosts) if (urlSet.has(p.url)) targets.push(p)
    }
  }

  const errors: Array<{ url: string; error: string }> = []
  let suggestionsCreated = 0
  let skippedAlreadyOk = 0

  for (const target of targets) {
    try {
      // Existing inbound link sources for this target.
      const existing = new Set<string>()
      for (const post of allPosts) {
        if (post.webflowId === target.webflowId) continue
        if (bodyLinksTo(post.bodyHtml, target.url)) existing.add(post.webflowId)
      }

      // Update blog_health.inbound_internal_links cheaply.
      const nowIso = new Date().toISOString()
      try {
        const existsRow = await database
          .select({ url: schema.blogHealth.url })
          .from(schema.blogHealth)
          .where(eq(schema.blogHealth.url, target.url))
          .limit(1)
        if (existsRow.length > 0) {
          await database.update(schema.blogHealth)
            .set({ inboundInternalLinks: existing.size, updatedAt: nowIso })
            .where(eq(schema.blogHealth.url, target.url))
        }
      } catch {
        // best-effort — never block the scan
      }

      // If the post already has plenty of inbound links and the caller
      // didn't specifically request this URL, skip the analyser to keep
      // the slate tight.
      if (!targetUrl && existing.size >= 3) {
        skippedAlreadyOk++
        continue
      }

      // Extract phrases.
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

      // Wipe existing PENDING rows for this target before inserting fresh
      // ones, so the slate refreshes on re-scan. APPLIED + REJECTED rows
      // stay as audit trail.
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
      console.error(`link scan failed for ${target.url}`, err)
      errors.push({ url: target.url, error: message })
    }
  }

  return NextResponse.json({
    targetsScanned: targets.length,
    suggestionsCreated,
    skippedAlreadyOk,
    errors,
    completedAt: new Date().toISOString(),
  })
}

// Note: `LinkSuggestion` is exported from `lib/link-analyzer` directly.
// We cannot re-export non-route symbols from a Next.js route file —
// `next build` rejects it.
