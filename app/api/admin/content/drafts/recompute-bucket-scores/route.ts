/**
 * POST /api/admin/content/drafts/recompute-bucket-scores
 *
 * One-shot backfill: walks every content_drafts row that has reviewer
 * critiques but no scoreBreakdown.bucketScores, computes the 4-bucket
 * aggregation (AEO / Voice / Readability / SEO) from the latest
 * revision's reviewer rows, and persists it onto scoreBreakdown.
 *
 * Safe to re-run — only touches drafts where bucketScores is missing
 * or zeroed out.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, isNotNull, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const BUCKETS: Record<'aeo' | 'voice' | 'readability' | 'seo', { keys: string[]; max: number }> = {
  aeo:         { keys: ['seo_aeo', 'featured_snippet', 'voice_search', 'citations', 'internal_links'], max: 25 },
  voice:       { keys: ['brand_tone', 'tahi_voice', 'anti_ai', 'hook', 'emotional_resonance'],         max: 25 },
  readability: { keys: ['pacing', 'skim_test', 'mobile_reading', 'visual_layout'],                     max: 20 },
  seo:         { keys: ['originality', 'unique_angle', 'counter_argument', 'icp_reader'],              max: 20 },
}

function computeBucketScores(reviews: Array<{ key: string; score: number | null | undefined }>): { aeo: number; voice: number; readability: number; seo: number } {
  const scoreByKey = new Map<string, number>()
  for (const r of reviews) {
    if (typeof r.score === 'number' && !Number.isNaN(r.score)) scoreByKey.set(r.key, r.score)
  }
  const out = { aeo: 0, voice: 0, readability: 0, seo: 0 }
  for (const k of Object.keys(BUCKETS) as Array<keyof typeof BUCKETS>) {
    const def = BUCKETS[k]
    const vals = def.keys.map(key => scoreByKey.get(key)).filter((v): v is number => typeof v === 'number')
    if (vals.length === 0) continue
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    out[k] = Math.round((avg / 100) * def.max)
  }
  return out
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()

  const drafts = await database
    .select({
      id: schema.contentDrafts.id,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
    })
    .from(schema.contentDrafts)
    .where(isNotNull(schema.contentDrafts.contentScore))
    .limit(500)

  let touched = 0
  let skipped = 0
  const errors: string[] = []

  for (const d of drafts) {
    let sb: Record<string, unknown> = {}
    try { sb = JSON.parse(d.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
    const existing = sb.bucketScores as Record<string, number> | undefined
    const hasNonZero = existing && Object.values(existing).some(v => typeof v === 'number' && v > 0)
    if (hasNonZero) { skipped++; continue }

    // Find the highest revision number that ACTUALLY has reviewer rows.
    // The latest revision in draft_revisions is usually the editor's
    // post-merge revision which has 0 reviewer rows (reviews were
    // against the prior revision); querying draft_reviews directly
    // for max(revisionNumber) gives us the revision the buckets should
    // reflect.
    const [maxRevRow] = await database
      .select({ maxN: sql<number>`MAX(${schema.draftReviews.revisionNumber})` })
      .from(schema.draftReviews)
      .where(eq(schema.draftReviews.draftId, d.id))
    const reviewRev = maxRevRow?.maxN ?? null
    if (reviewRev == null) { skipped++; continue }

    const reviews = await database
      .select({ reviewerKey: schema.draftReviews.reviewerKey, score: schema.draftReviews.score })
      .from(schema.draftReviews)
      .where(and(
        eq(schema.draftReviews.draftId, d.id),
        eq(schema.draftReviews.revisionNumber, reviewRev),
      ))
    if (reviews.length === 0) { skipped++; continue }

    try {
      sb.bucketScores = computeBucketScores(reviews.map(r => ({ key: r.reviewerKey, score: r.score })))
      await database.update(schema.contentDrafts).set({
        scoreBreakdown: JSON.stringify(sb),
      }).where(eq(schema.contentDrafts.id, d.id))
      touched++
    } catch (err) {
      errors.push(`${d.id}: ${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`)
    }
  }

  return NextResponse.json({ ok: true, touched, skipped, scanned: drafts.length, errors: errors.slice(0, 10) })
}
