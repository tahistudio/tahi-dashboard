/**
 * POST /api/admin/content/audits/[id]/improve
 *
 * Runs the editor on an audited shadow draft using the stored 23
 * reviewer critiques as input, producing a revised body. The improved
 * body is stored as a new revision + re-scored by sign-off.
 *
 * Does NOT push to Webflow. Liam reviews the before/after on the
 * round-table page first; pushing is a separate explicit action.
 *
 * Guards:
 *   - draft must be origin_source='legacy_audit'
 *   - draft must be status='audited' (the previous run finished)
 *
 * Result is stashed on scoreBreakdown.improvement:
 *   {
 *     appliedAt: ISO,
 *     prevScore: number,
 *     newScore: number,
 *     newScoreNotes: string,
 *     newRevisionNumber: number,
 *     costCents: number,
 *   }
 *
 * Status stays 'audited' — the UI surfaces the improvement via the
 * revisions list + the scoreBreakdown.improvement field.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'
import { claudeJson } from '@/lib/anthropic-cost'
import { OPUS_MODEL } from '@/lib/ai-models'
import {
  EDITOR_SYSTEM, buildEditorPrompt, parseEditor,
  SIGN_OFF_SYSTEM, buildSignOffPrompt, parseSignOff,
  type StrategistOutput,
} from '@/lib/round-table-leads'
import type { ReviewerCritique } from '@/lib/round-table-reviewers'
import { markdownToHtml } from '@/lib/markdown-render'
import { loadBlogContext, linkableUrlSet, sanitizeInternalLinks, sanitizeCompetitorLinks } from '@/lib/blog-context'
import type { ReviewerKey } from '@/lib/round-table-reviewers'

export const dynamic = 'force-dynamic'

function estimateWordCount(md: string): number {
  return md.replace(/[#*_`>\[\]()]/g, '').split(/\s+/).filter(Boolean).length
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing audit id' }, { status: 400 })

  const database = await db()
  const [draft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (draft.originSource !== 'legacy_audit') {
    return NextResponse.json({ error: 'This draft is not an audit shadow draft.' }, { status: 409 })
  }
  if (draft.status !== 'audited') {
    return NextResponse.json({
      error: `Improvements can only be applied once the audit has completed (current: ${draft.status}).`,
    }, { status: 409 })
  }

  // Pull the brief from the stored audit scoreBreakdown.
  const sb: Record<string, unknown> = (() => {
    try { return JSON.parse(draft.scoreBreakdown ?? '{}') as Record<string, unknown> } catch { return {} }
  })()
  if (!sb.brief) return NextResponse.json({ error: 'Audit brief missing from draft' }, { status: 409 })
  const brief = sb.brief as StrategistOutput

  // Find the latest revision number so we know which reviewer rows belong
  // to this audit's score. For audits we have only 1 revision (the
  // originally fetched body); future improvements layer on top.
  const revs = await database
    .select({ n: schema.draftRevisions.revisionNumber })
    .from(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, id))
    .orderBy(desc(schema.draftRevisions.revisionNumber))
    .limit(1)
  const latestRev = revs[0]?.n ?? 0

  // Pull the reviews from the original audit pass — we use these as the
  // editor's input critiques. For a fresh audit-improve, revisionNumber
  // is 1 (the body the audit scored); subsequent improvements would
  // need to re-review for those revision numbers, but slice 2 only
  // covers the first improvement attempt off the audit baseline.
  const reviews = await database
    .select()
    .from(schema.draftReviews)
    .where(and(
      eq(schema.draftReviews.draftId, id),
      eq(schema.draftReviews.revisionNumber, Math.max(latestRev, 1)),
    ))
  if (reviews.length === 0) {
    return NextResponse.json({ error: 'No reviewer critiques to act on. Audit may not have completed correctly.' }, { status: 409 })
  }

  // Dedupe by reviewer key, keep the last entry.
  const byReviewer = new Map<string, typeof reviews[number]>()
  for (const r of reviews) {
    if (r.critique != null) byReviewer.set(r.reviewerKey, r)
  }
  const reviewsForEditor = Array.from(byReviewer.values()).map(r => ({
    reviewerKey: r.reviewerKey as ReviewerKey,
    weight: parseFloat(r.weight ?? '1'),
    critique: JSON.parse(r.critique ?? '{}') as ReviewerCritique,
  }))

  // 1) Editor pass — produce improved body.
  let editorResult
  let editorCents = 0
  try {
    const out = await claudeJson({
      database, scope: 'draft', scopeId: id, stage: 'editor_audit_improve',
      model: OPUS_MODEL, maxTokens: 8000,
      skipCostCap: true,
      systemPrompt: EDITOR_SYSTEM,
      userPrompt: buildEditorPrompt({
        brief,
        currentBodyMarkdown: draft.bodyMarkdown ?? '',
        currentBodyHtml: draft.bodyHtml ?? '',
        reviews: reviewsForEditor,
      }),
      parse: parseEditor,
    })
    editorResult = out.result
    editorCents = out.costCents
  } catch (err) {
    return NextResponse.json({
      error: 'Editor pass failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  // 2) Sanitize fabricated internal links + competitor agency links.
  let cleanMarkdown = editorResult.bodyMarkdown
  let fabricatedRemoved = 0
  let competitorRemoved = 0
  try {
    const blogCtx = await loadBlogContext()
    const sani = sanitizeInternalLinks(cleanMarkdown, linkableUrlSet(blogCtx))
    cleanMarkdown = sani.markdown
    fabricatedRemoved = sani.removed.length
  } catch { /* leave as-is if context unavailable */ }
  const compSani = sanitizeCompetitorLinks(cleanMarkdown)
  cleanMarkdown = compSani.markdown
  competitorRemoved = compSani.removed.length

  // 3) Render HTML.
  const improvedHtml = markdownToHtml(cleanMarkdown)
  const improvedWordCount = estimateWordCount(cleanMarkdown)

  // 4) Re-run sign-off on the improved body for a new score.
  let newScore = 0
  let newScoreNotes = ''
  let signoffCents = 0
  try {
    const sOut = await claudeJson({
      database, scope: 'draft', scopeId: id, stage: 'signoff_audit_improve',
      model: OPUS_MODEL, maxTokens: 1500,
      skipCostCap: true,
      systemPrompt: SIGN_OFF_SYSTEM,
      userPrompt: buildSignOffPrompt({
        brief,
        bodyMarkdown: cleanMarkdown,
        editorWeightedScore: draft.contentScore ?? 0,
      }),
      parse: parseSignOff,
    })
    newScore = sOut.result.score
    newScoreNotes = sOut.result.finalNotes
    signoffCents = sOut.costCents
  } catch (err) {
    console.error('improvement signoff failed', err)
  }

  // 5) Store the new revision.
  const nextRev = latestRev + 1
  const nowIso = new Date().toISOString()
  await database.insert(schema.draftRevisions).values({
    id: crypto.randomUUID(),
    draftId: id,
    revisionNumber: nextRev,
    source: 'audit_improvement',
    bodyHtml: improvedHtml,
    bodyMarkdown: cleanMarkdown,
    wordCount: improvedWordCount,
    reason: `Audit improvement: ${editorResult.changesSummary}`,
    createdAt: nowIso,
    updatedAt: nowIso,
  })

  // 6) Stash the improvement result on scoreBreakdown so the UI knows
  //    there's an improved revision + a new score to surface.
  const totalCents = editorCents + signoffCents
  const improvement = {
    appliedAt: nowIso,
    prevScore: draft.contentScore,
    newScore,
    newScoreNotes,
    newRevisionNumber: nextRev,
    costCents: totalCents,
    fabricatedLinksStripped: fabricatedRemoved,
    competitorLinksStripped: competitorRemoved,
    changesSummary: editorResult.changesSummary,
  }
  sb.improvement = improvement
  // Also bump the live draft body so the article preview shows the
  // improvement. (revisions list lets Liam still compare.)
  await database.update(schema.contentDrafts).set({
    bodyHtml: improvedHtml,
    bodyMarkdown: cleanMarkdown,
    scoreBreakdown: JSON.stringify(sb),
    updatedAt: nowIso,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({
    ok: true,
    prevScore: draft.contentScore,
    newScore,
    delta: newScore - (draft.contentScore ?? 0),
    newRevisionNumber: nextRev,
    fabricatedLinksStripped: fabricatedRemoved,
    competitorLinksStripped: competitorRemoved,
    costCents: totalCents,
    message: 'Improvement applied. Compare revisions on the round-table page; Webflow is unchanged.',
  })
}
