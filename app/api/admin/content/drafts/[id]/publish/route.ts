/**
 * POST /api/admin/content/drafts/[id]/publish
 *
 * Phase I · Slice 5 — push a ready draft into Webflow as a Blog Posts
 * collection item.
 *
 * Body:
 *   {
 *     mode: 'now' | 'custom' | 'auto'
 *     customDate?: string   // ISO datetime, required when mode === 'custom'
 *   }
 *
 * Behaviour:
 *   1. Loads the draft. Must have status='ready'.
 *   2. Resolves Authors / Categories collection references from Webflow.
 *   3. Builds the full CMS fieldData payload (every field listed in
 *      WORKFLOWS Phase I).
 *   4. Calls computeNextSlot() with publish_history rows to pick the
 *      target datetime + flag any cooldown conflicts.
 *   5. If the slot is now (or within 60 seconds), creates the item as
 *      live (isDraft=false) and immediately publishes. Otherwise creates
 *      the item staged (isDraft=true) and parks the scheduledFor on the
 *      draft — the publish-scheduled cron flips it live when the time
 *      arrives.
 *   6. Writes a publish_history row, updates the draft + idea, and
 *      best-effort pings IndexNow for "now" publishes.
 *
 * Response:
 *   {
 *     webflowItemId: string
 *     publishUrl: string
 *     scheduledFor: string
 *     publishedAt: string | null     // set only when actually went live
 *     cooldownConflicts?: Array<{ title?: string; publishedAt: string }>
 *   }
 *
 * Admin-only.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'
import {
  createCollectionItem,
  publishCollectionItems,
  getBlogPostsCollectionId,
  loadBlogReferenceLookups,
} from '@/lib/webflow'
import { computeNextSlot, type PublishMode } from '@/lib/publish-scheduler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TAHI_BLOG_BASE = 'https://www.tahi.studio/blog'

interface BodyShape {
  mode?: string
  customDate?: string
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Draft id is required' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as BodyShape
  const mode = body.mode as (PublishMode | 'draft') | undefined
  if (!mode || !['now', 'custom', 'auto', 'draft'].includes(mode)) {
    return NextResponse.json(
      { error: "mode must be one of 'now' | 'custom' | 'auto' | 'draft'" },
      { status: 400 },
    )
  }
  if (mode === 'custom' && !body.customDate) {
    return NextResponse.json(
      { error: "customDate is required when mode === 'custom'" },
      { status: 400 },
    )
  }

  const database = await db()

  // 1) Load draft
  let [draft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  // 'ready' = legacy Slice-2 drafts; 'ready_for_publish' = round-table
  // (Slice 9) drafts. Both are publishable.
  if (draft.status !== 'ready' && draft.status !== 'ready_for_publish') {
    return NextResponse.json(
      { error: `Draft must be ready to publish (current: ${draft.status})` },
      { status: 409 },
    )
  }
  if (draft.publishedWebflowItemId) {
    return NextResponse.json(
      {
        error: 'Draft already published to Webflow',
        webflowItemId: draft.publishedWebflowItemId,
        publishUrl: draft.publishUrl,
      },
      { status: 409 },
    )
  }

  // Regenerate schema/hreflang/category against the FINAL state right
  // before publishing. The cover image is usually set after the pipeline
  // ran (Staci upload / regenerate), so the schema baked in at pipeline
  // time would otherwise have an empty image. This guarantees the JSON-LD
  // shipped to Webflow reflects the actual cover + body + category.
  // Round-table drafts only — legacy 'ready' drafts already have schema.
  if (draft.status === 'ready_for_publish') {
    try {
      const { finalizeWebflowFields } = await import('@/lib/blog-finalize')
      await finalizeWebflowFields(database, id)
      const [refreshed] = await database
        .select().from(schema.contentDrafts)
        .where(eq(schema.contentDrafts.id, id)).limit(1)
      if (refreshed) draft = refreshed
    } catch (err) {
      console.error('Pre-publish finalize failed', err)
    }
  }

  // 2) Compute the target slot. Pull recent publish_history for the
  // rolling-7-day cap and the cluster cooldown check.
  const recentRows = await database
    .select({
      publishedAt: schema.publishHistory.publishedAt,
      clusterSlug: schema.publishHistory.clusterSlug,
      title: schema.publishHistory.title,
    })
    .from(schema.publishHistory)
    .orderBy(sql`${schema.publishHistory.publishedAt} DESC`)
    .limit(50)

  const slotResult = (() => {
    try {
      return computeNextSlot({
        // 'draft' mode just stages the item in Webflow with no schedule;
        // compute a throwaway slot so the cooldown math still runs, but we
        // never act on it below.
        mode: mode === 'draft' ? 'auto' : mode,
        customDate: body.customDate,
        recentSlots: recentRows.map(r => r.publishedAt),
        newCluster: draft.mainCategorySlug ?? '',
        recentClusters: recentRows.map(r => ({
          cluster: r.clusterSlug ?? '',
          publishedAt: r.publishedAt,
          title: r.title,
        })),
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })()
  if ('error' in slotResult) {
    return NextResponse.json({ error: slotResult.error }, { status: 400 })
  }

  // 3) Resolve Webflow references
  let collectionId: string
  let refLookup: Awaited<ReturnType<typeof loadBlogReferenceLookups>>
  try {
    collectionId = await getBlogPostsCollectionId()
    refLookup = await loadBlogReferenceLookups()
  } catch (err) {
    console.error('Webflow lookup failed', err)
    return NextResponse.json(
      { error: 'Failed to resolve Webflow collections. Check WEBFLOW_TOKEN.' },
      { status: 503 },
    )
  }

  const authorSlug = (draft.authorSlug ?? 'liam').toLowerCase()
  const authorWebflowId =
    refLookup.authorsBySlug.get(authorSlug)
    ?? refLookup.authorsByNamePart.get(authorSlug)
    ?? refLookup.authorsByNamePart.get(`${authorSlug} miller`)
    ?? null

  const mainCategorySlug = (draft.mainCategorySlug ?? '').toLowerCase()
  const mainCategoryWebflowId =
    refLookup.categoriesBySlug.get(mainCategorySlug)
    ?? refLookup.categoriesByName.get(mainCategorySlug.replace(/-/g, ' '))
    ?? null

  if (!authorWebflowId) {
    return NextResponse.json(
      { error: `Could not resolve Webflow author for slug "${authorSlug}". Make sure the Authors collection has a matching item.` },
      { status: 422 },
    )
  }
  if (!mainCategoryWebflowId) {
    return NextResponse.json(
      { error: `Could not resolve Webflow category for slug "${mainCategorySlug}". Make sure the Categories collection has a matching item.` },
      { status: 422 },
    )
  }

  // other-categories: main category FIRST, then any extras (deduped).
  // If there are no extras it's just [main] — Liam's "repeat the main"
  // rule — so the template's category block always renders something.
  const otherCategoryWebflowIds: string[] = (() => {
    const ids: string[] = mainCategoryWebflowId ? [mainCategoryWebflowId] : []
    if (draft.otherCategorySlugs) {
      try {
        const parsed = JSON.parse(draft.otherCategorySlugs)
        if (Array.isArray(parsed)) {
          for (const raw of parsed) {
            if (typeof raw !== 'string') continue
            const slug = raw.toLowerCase()
            const wfId =
              refLookup.categoriesBySlug.get(slug)
              ?? refLookup.categoriesByName.get(slug.replace(/-/g, ' '))
            if (wfId && !ids.includes(wfId)) ids.push(wfId)
          }
        }
      } catch { /* keep [main] */ }
    }
    return ids
  })()

  // 4) Parse FAQs into 6 discrete fields (Webflow CMS layout)
  const faqs = (() => {
    if (!draft.faqsJson) return [] as Array<{ q: string; a: string }>
    try {
      const parsed = JSON.parse(draft.faqsJson)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (f): f is { q: string; a: string } =>
          !!f && typeof f === 'object'
          && typeof (f as { q?: unknown }).q === 'string'
          && typeof (f as { a?: unknown }).a === 'string',
      )
    } catch {
      return []
    }
  })()

  // FAQ section heading + purpose-written aiPrompt stashed in
  // scoreBreakdown by the structurer.
  const { faqHeading, aiPrompt } = (() => {
    try {
      const sb = JSON.parse(draft.scoreBreakdown ?? '{}') as { faqHeading?: string; aiPrompt?: string }
      return { faqHeading: sb.faqHeading ?? '', aiPrompt: sb.aiPrompt ?? '' }
    } catch { return { faqHeading: '', aiPrompt: '' } }
  })()

  // 5) Build the fieldData payload
  const slug = slugify(draft.shortenedName ?? draft.title ?? draft.id)
  const publishUrl = `${TAHI_BLOG_BASE}/${slug}`
  const fieldData: Record<string, unknown> = {
    name: draft.title ?? draft.shortenedName ?? 'Untitled',
    slug,
    'post-body': draft.bodyHtml ?? '',
    'summary-2': draft.summary ?? draft.postExcerpt ?? '',
    'key-takeaways': draft.keyTakeaways ?? '',
    // FAQ section heading — slug assumed 'faq-section-heading' (Webflow's
    // auto-slug for "FAQ section heading"). Verify via field-audit; easy
    // to change here if Webflow used a different slug.
    'faq-section-heading': faqHeading,
    schema: draft.schemaJsonLd ?? '',
    'hreflang-block': draft.hreflangBlock ?? '',
    'meta-title': draft.metaTitle ?? draft.title ?? '',
    'meta-description-2': draft.metaDescription ?? '',
    'post-description': draft.postExcerpt ?? '',
    'shortened-name': draft.shortenedName ?? '',
    // Purpose-written by the structurer — "ask AI about this post" prompt
    // tailored to this article's angle. Falls back to summary only if the
    // structurer didn't produce one (legacy drafts).
    'ai-prompt': aiPrompt || draft.summary || draft.metaDescription || '',
    'related-blog-posts': await (async () => {
      try {
        const { findRelatedBlogPosts } = await import('@/lib/site-index')
        const { listCollectionItems } = await import('@/lib/webflow')
        const related = await findRelatedBlogPosts(database, [
          draft.title ?? '', draft.summary ?? '', (draft.bodyMarkdown ?? '').slice(0, 3000),
        ].join('\n'), {
          topN: 3, minSimilarity: 0.5,
          excludeRelativeUrl: `/blog/${slug}`,
        })
        if (related.length === 0) return [] as string[]
        // Resolve relative URLs -> Webflow item IDs by paging the Blog Posts
        // collection and matching slugs. Bounded to 5 pages of 100 = 500 posts.
        const wantSlugs = new Set(related.map(r => r.relativeUrl.replace(/^\/blog\//, '')))
        const slugToId = new Map<string, string>()
        let offset = 0
        for (let i = 0; i < 5; i++) {
          const { items, total } = await listCollectionItems(collectionId, { limit: 100, offset })
          for (const it of items) {
            const s = (it.fieldData?.slug as string | undefined) ?? ''
            if (s && wantSlugs.has(s)) slugToId.set(s, it.id)
          }
          if (slugToId.size >= wantSlugs.size) break
          if (items.length < 100) break
          offset += items.length
          if (offset >= total) break
        }
        return related
          .map(r => slugToId.get(r.relativeUrl.replace(/^\/blog\//, '')))
          .filter((x): x is string => !!x)
      } catch (err) {
        console.error('related-blog-posts lookup failed', err)
        return [] as string[]
      }
    })(),
    'main-image': draft.coverSvgUrl ?? '',
    'thumbnail-image-2': draft.coverSvgUrl ?? '',
    featured: false,
    author: authorWebflowId,
    'main-category': mainCategoryWebflowId,
    'other-categories': otherCategoryWebflowIds,
  }
  // FAQ Q/A 1-6. Missing slots stay empty so Webflow doesn't reject the
  // payload over required-but-empty fields.
  //
  // Questions are PLAIN TEXT (structurer's stripMarkdownLinksAndTags
  // sanitiser already cleaned any link wrappers). Answers are RICH
  // TEXT — convert any markdown the writer left (inline links,
  // bold, italics) into HTML so Webflow's rich text field renders
  // them as actual <a> tags + emphasis instead of literal
  // "[text](url)" strings on the page.
  const { markdownToHtml: mdToHtml } = await import('@/lib/markdown-render')
  for (let i = 1; i <= 6; i++) {
    const faq = faqs[i - 1]
    fieldData[`faq-question-${i}`] = faq?.q ?? ''
    fieldData[`faq-answer-${i}`] = faq?.a ? mdToHtml(faq.a) : ''
  }

  // 6) Decide: publish-now vs schedule. 60-second slack window so a user
  // who picked "now" doesn't get pushed into the staged branch by clock
  // skew.
  const isDraftMode = mode === 'draft'
  const scheduledForMs = Date.parse(slotResult.scheduledFor)
  const nowMs = Date.now()
  const publishNow = !isDraftMode && scheduledForMs <= nowMs + 60_000

  let webflowItemId: string
  let publishedAtIso: string | null = null
  try {
    const created = await createCollectionItem(collectionId, fieldData, {
      // Live publish: create the item un-drafted so the subsequent
      // publish call promotes it cleanly. Scheduled + draft: stage it
      // (isDraft true) so it sits in Webflow unpublished.
      isDraft: !publishNow,
    })
    webflowItemId = created.id
    if (publishNow) {
      await publishCollectionItems(collectionId, [created.id])
      publishedAtIso = new Date().toISOString()
    }
  } catch (err) {
    console.error('Webflow publish failed', err)
    return NextResponse.json(
      {
        error: 'Failed to push to Webflow',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }

  // 7) Persist. For draft mode we only record the Webflow item id (it's
  // staged, unpublished, unscheduled) — no publish_history row, idea stays
  // 'drafted'. For now/scheduled we write history + flip the idea.
  const nowIso = new Date().toISOString()
  if (!isDraftMode) {
    await database.insert(schema.publishHistory).values({
      id: crypto.randomUUID(),
      draftId: draft.id,
      webflowItemId,
      url: publishUrl,
      title: draft.title ?? draft.shortenedName ?? 'Untitled',
      clusterSlug: draft.mainCategorySlug ?? null,
      targetKeyword: null,
      publishedAt: publishNow ? (publishedAtIso ?? nowIso) : slotResult.scheduledFor,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Enqueue back-link job, but ONLY when the post is actually LIVE now.
    // Scheduled posts (publishNow=false) will be enqueued by the
    // publish-scheduled cron when it flips them live.
    if (publishNow) {
      try {
        await database.insert(schema.backlinkQueue).values({
          id: crypto.randomUUID(),
          newPostUrl: publishUrl,
          newPostSlug: slug,
          newPostWebflowId: webflowItemId,
          status: 'queued',
          attempts: 0,
          createdAt: nowIso,
        })
      } catch (err) {
        console.error('back-link enqueue failed', err)
      }

      // Seed this just-published post into site_index immediately so
      // the NEXT publish's glossary auto-link, related-posts, and
      // back-link discovery can already see it. Weekly cron handles
      // the rest of the catalogue. Best-effort — non-blocking.
      try {
        const { upsertSiteIndexEntry } = await import('@/lib/site-index')
        void upsertSiteIndexEntry(database, publishUrl)
      } catch (err) {
        console.error('site-index upsert (publish) failed', err)
      }
    }
  }

  await database
    .update(schema.contentDrafts)
    .set({
      publishedWebflowItemId: webflowItemId,
      scheduledFor: (publishNow || isDraftMode) ? null : slotResult.scheduledFor,
      publishedAt: publishedAtIso,
      publishUrl,
      updatedAt: nowIso,
    })
    .where(eq(schema.contentDrafts.id, draft.id))

  // Flip the source idea: 'published' when live, 'scheduled' when dated,
  // left as-is for a plain Webflow draft.
  if (!isDraftMode) {
    await database
      .update(schema.contentIdeas)
      .set({
        status: publishNow ? 'published' : 'scheduled',
        updatedAt: nowIso,
      })
      .where(eq(schema.contentIdeas.id, draft.ideaId))
  }

  // 8) Best-effort IndexNow ping for live publishes. Never blocks the
  // happy path — IndexNow downtime / mis-config must not kill a publish.
  if (publishNow) {
    try {
      const origin = new URL(req.url).origin
      const cookie = req.headers.get('cookie')
      const auth = req.headers.get('authorization')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cookie) headers.cookie = cookie
      if (auth) headers.authorization = auth
      // Fire-and-forget. Don't await — even if it 503s we don't care here.
      void fetch(`${origin}/api/admin/content/health/indexnow`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls: [publishUrl] }),
      }).catch(() => undefined)
    } catch {
      // swallow — strictly best-effort
    }
  }

  return NextResponse.json({
    webflowItemId,
    publishUrl,
    scheduledFor: slotResult.scheduledFor,
    publishedAt: publishedAtIso,
    reason: slotResult.reason,
    cooldownConflicts: slotResult.cooldownConflicts,
  })
}
