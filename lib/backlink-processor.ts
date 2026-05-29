/**
 * lib/backlink-processor.ts
 *
 * Processes the back-link queue. For each newly LIVE blog post:
 *   1. Find top old posts where similarity >= 0.72 (semantic match).
 *   2. Filter out: same post, posts at lifetime cap (8), posts in 30-day
 *      cooldown.
 *   3. Take top 5 of what remains.
 *   4. For each chosen old post: fetch its current body from Webflow,
 *      ask Sonnet to pick the best paragraph + write a 1-sentence
 *      contextual inline link, PATCH the body back to Webflow.
 *   5. Update backlink_stats + the queue row's `applied` JSON.
 */

import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { eq, and, lt, asc } from 'drizzle-orm'
import { claudeJson } from '@/lib/anthropic-cost'
import { SONNET_MODEL } from '@/lib/ai-models'
import { findRelatedBlogPosts } from '@/lib/site-index'
import { getBlogPostsCollectionId, getCollectionItem, patchCollectionItem, publishCollectionItems } from '@/lib/webflow'

type DrizzleDB = Awaited<ReturnType<typeof db>>

const MAX_PER_NEW_POST = 5
const MAX_PER_OLD_POST_LIFETIME = 8
const COOLDOWN_DAYS = 30
const SIMILARITY_THRESHOLD = 0.72

export interface BacklinkProcessResult {
  jobsProcessed: number
  linksApplied: number
  jobsFailed: number
  details: Array<{
    jobId: string
    newPostUrl: string
    applied: Array<{ oldPostUrl: string; similarity: number; ok: boolean; error?: string }>
  }>
}

async function chooseInsertionParagraph(
  database: DrizzleDB,
  jobId: string,
  newPostTitle: string,
  newPostSummary: string,
  newPostUrl: string,
  oldPostBodyHtml: string,
): Promise<{ revisedBodyHtml: string; insertedAt: string } | null> {
  // Crude paragraph split — Webflow HTML uses <p>...</p>.
  const paragraphs = Array.from(oldPostBodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map(m => ({ outer: m[0], inner: m[1] }))
  if (paragraphs.length === 0) return null

  // Build prompt: show the candidate paragraphs + ask Sonnet to pick
  // one + return a revised version with an inline contextual link
  // already added (single sentence) pointing at newPostUrl.
  const numberedParas = paragraphs.map((p, i) => `[${i}] ${p.inner.replace(/<[^>]+>/g, '').slice(0, 400)}`).join('\n\n')

  try {
    const { result } = await claudeJson({
      database, scope: 'links', scopeId: jobId, stage: 'backlink_insert',
      model: SONNET_MODEL, maxTokens: 800,
      skipCostCap: true,
      systemPrompt: `You insert ONE contextual link into an existing blog post. You are given a list of numbered paragraphs from the post and the URL + title + summary of a NEW post that is semantically related. You pick the SINGLE paragraph where a link to the new post would feel most natural to the reader, then output a revised version of that paragraph that includes one inline anchor tag like <a href="URL">anchor text</a>. The anchor text should be 2-6 words and read naturally inline. Do not rewrite the rest of the paragraph. If no paragraph is a good fit, return { "skip": true } and we'll skip this old post.`,
      userPrompt: `New post URL: ${newPostUrl}\nNew post title: ${newPostTitle}\nNew post summary: ${newPostSummary}\n\nCandidate paragraphs (numbered):\n${numberedParas}\n\nReturn JSON: { "paragraphIndex": number, "revisedInnerHtml": "the paragraph's new inner HTML including the <a> tag" } OR { "skip": true } if none are a good contextual fit.`,
      parse: (raw: string) => JSON.parse(raw) as { paragraphIndex?: number; revisedInnerHtml?: string; skip?: boolean },
    })

    if (result.skip || typeof result.paragraphIndex !== 'number' || !result.revisedInnerHtml) return null
    const idx = result.paragraphIndex
    if (idx < 0 || idx >= paragraphs.length) return null

    const chosen = paragraphs[idx]
    const newParaOuter = chosen.outer.replace(chosen.inner, result.revisedInnerHtml)
    const revisedBodyHtml = oldPostBodyHtml.replace(chosen.outer, newParaOuter)
    return { revisedBodyHtml, insertedAt: new Date().toISOString() }
  } catch {
    return null
  }
}

export async function processBacklinkQueue(
  database: DrizzleDB,
  opts: { maxJobs?: number; budgetMs?: number } = {},
): Promise<BacklinkProcessResult> {
  const maxJobs = opts.maxJobs ?? 3
  const budgetMs = opts.budgetMs ?? 25_000
  const t0 = Date.now()

  const result: BacklinkProcessResult = { jobsProcessed: 0, linksApplied: 0, jobsFailed: 0, details: [] }

  // Pull queued jobs oldest-first.
  const jobs = await database
    .select()
    .from(schema.backlinkQueue)
    .where(eq(schema.backlinkQueue.status, 'queued'))
    .orderBy(asc(schema.backlinkQueue.createdAt))
    .limit(maxJobs)

  if (jobs.length === 0) return result

  const cooldownIso = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString()
  const collectionId = await getBlogPostsCollectionId().catch(() => null)
  if (!collectionId) return result

  for (const job of jobs) {
    if (Date.now() - t0 > budgetMs) break
    const jobDetails: BacklinkProcessResult['details'][number] = {
      jobId: job.id, newPostUrl: job.newPostUrl, applied: [],
    }

    // Mark processing.
    await database.update(schema.backlinkQueue).set({
      status: 'processing', attempts: (job.attempts ?? 0) + 1,
    }).where(eq(schema.backlinkQueue.id, job.id))

    try {
      // 1) Find candidates. We need text describing the new post; pull
      // its row from site_index if available.
      const [siRow] = await database
        .select({ title: schema.siteIndex.title, summary: schema.siteIndex.summary })
        .from(schema.siteIndex)
        .where(eq(schema.siteIndex.url, job.newPostUrl))
        .limit(1)
      const newPostTitle = siRow?.title ?? job.newPostSlug
      const newPostSummary = siRow?.summary ?? ''

      const candidates = await findRelatedBlogPosts(database, `${newPostTitle}\n${newPostSummary}`, {
        topN: 25, // wide net so we can filter
        minSimilarity: SIMILARITY_THRESHOLD,
        excludeRelativeUrl: `/blog/${job.newPostSlug}`,
      })

      // 2) Filter by cap + cooldown.
      const eligible: typeof candidates = []
      for (const c of candidates) {
        const [stats] = await database
          .select()
          .from(schema.backlinkStats)
          .where(eq(schema.backlinkStats.postUrl, c.url))
          .limit(1)
        if (stats) {
          if ((stats.totalApplied ?? 0) >= MAX_PER_OLD_POST_LIFETIME) continue
          if (stats.lastAppliedAt && stats.lastAppliedAt > cooldownIso) continue
        }
        eligible.push(c)
        if (eligible.length >= MAX_PER_NEW_POST) break
      }

      // 3) For each eligible old post: insert a contextual link via Sonnet.
      const applied: Array<{ oldPostUrl: string; oldPostWebflowId: string; similarity: number; linkedAt: string }> = []
      for (const old of eligible) {
        if (Date.now() - t0 > budgetMs) break

        // Resolve old post URL -> Webflow item id by walking the collection.
        // We could cache this; for now query Webflow to find the matching slug.
        const oldSlug = old.relativeUrl.replace(/^\/blog\//, '')

        // Cheap path: fetch all blog items (paginated), find by slug.
        let oldItem: { id: string; fieldData: Record<string, unknown> } | null = null
        try {
          const { listCollectionItems } = await import('@/lib/webflow')
          let offset = 0
          for (let i = 0; i < 5; i++) {
            const { items, total } = await listCollectionItems(collectionId, { limit: 100, offset })
            for (const it of items) {
              const s = (it.fieldData?.slug as string | undefined) ?? ''
              if (s === oldSlug) { oldItem = { id: it.id, fieldData: it.fieldData }; break }
            }
            if (oldItem) break
            if (items.length < 100) break
            offset += items.length
            if (offset >= total) break
          }
        } catch (err) {
          jobDetails.applied.push({ oldPostUrl: old.url, similarity: old.similarity, ok: false, error: 'listCollectionItems failed' })
          continue
        }
        if (!oldItem) {
          jobDetails.applied.push({ oldPostUrl: old.url, similarity: old.similarity, ok: false, error: 'old item not found by slug' })
          continue
        }

        const oldBodyHtml = (oldItem.fieldData['post-body'] as string | undefined) ?? ''
        if (!oldBodyHtml) {
          jobDetails.applied.push({ oldPostUrl: old.url, similarity: old.similarity, ok: false, error: 'empty body' })
          continue
        }

        const chosen = await chooseInsertionParagraph(
          database, job.id, newPostTitle, newPostSummary, job.newPostUrl, oldBodyHtml,
        )
        if (!chosen) {
          jobDetails.applied.push({ oldPostUrl: old.url, similarity: old.similarity, ok: false, error: 'no suitable paragraph' })
          continue
        }

        // PATCH back to Webflow + publish so the link is live immediately.
        try {
          await patchCollectionItem(collectionId, oldItem.id, { 'post-body': chosen.revisedBodyHtml })
          await publishCollectionItems(collectionId, [oldItem.id]).catch(() => { /* best-effort */ })
        } catch (err) {
          jobDetails.applied.push({
            oldPostUrl: old.url, similarity: old.similarity, ok: false,
            error: err instanceof Error ? err.message.slice(0, 120) : 'Webflow patch failed',
          })
          continue
        }

        // Update stats.
        const nowIso = new Date().toISOString()
        const [stats] = await database
          .select()
          .from(schema.backlinkStats)
          .where(eq(schema.backlinkStats.postUrl, old.url))
          .limit(1)
        if (stats) {
          await database.update(schema.backlinkStats).set({
            postWebflowId: oldItem.id,
            totalApplied: (stats.totalApplied ?? 0) + 1,
            lastAppliedAt: nowIso, updatedAt: nowIso,
          }).where(eq(schema.backlinkStats.postUrl, old.url))
        } else {
          await database.insert(schema.backlinkStats).values({
            postUrl: old.url, postWebflowId: oldItem.id,
            totalApplied: 1, lastAppliedAt: nowIso, updatedAt: nowIso,
          })
        }

        applied.push({ oldPostUrl: old.url, oldPostWebflowId: oldItem.id, similarity: old.similarity, linkedAt: nowIso })
        jobDetails.applied.push({ oldPostUrl: old.url, similarity: old.similarity, ok: true })
        result.linksApplied++
      }

      // Mark job done.
      await database.update(schema.backlinkQueue).set({
        status: 'done', applied: JSON.stringify(applied),
        processedAt: new Date().toISOString(),
      }).where(eq(schema.backlinkQueue.id, job.id))
      result.jobsProcessed++
    } catch (err) {
      result.jobsFailed++
      await database.update(schema.backlinkQueue).set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        processedAt: new Date().toISOString(),
      }).where(eq(schema.backlinkQueue.id, job.id))
    }

    result.details.push(jobDetails)
  }

  // Suppress unused
  void lt
  return result
}
