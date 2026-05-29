/**
 * POST /api/admin/content/drafts/[id]/restructure
 *
 * Runs the decomposition step on an existing draft's current body —
 * splitting it into the discrete Webflow CMS fields (clean post-body with
 * FAQ + key-takeaways removed, separate FAQ pairs, key takeaways, meta).
 *
 * Built so drafts that finished BEFORE the structuring step existed (or
 * after a manual edit pass) can be made Webflow-ready without a full
 * re-run. Useful permanently after Liam's suggest-edits, not just a
 * one-off.
 *
 * Contract:
 *   POST -> { faqCount, takeawayCount, metaTitle, costCents }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { claudeJson } from '@/lib/anthropic-cost'
import { SONNET_MODEL } from '@/lib/ai-models'
import { markdownToHtml } from '@/lib/markdown-render'
import { STRUCTURE_SYSTEM, buildStructurePrompt, parseStructure } from '@/lib/round-table-leads'
import { loadBlogContext, linkableUrlSet, sanitizeInternalLinks, sanitizeCompetitorLinks } from '@/lib/blog-context'
import { finalizeWebflowFields } from '@/lib/blog-finalize'

export const dynamic = 'force-dynamic'

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      title: schema.contentDrafts.title,
      metaTitle: schema.contentDrafts.metaTitle,
      metaDescription: schema.contentDrafts.metaDescription,
      bodyMarkdown: schema.contentDrafts.bodyMarkdown,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (!draft.bodyMarkdown) return NextResponse.json({ error: 'Draft has no body to structure' }, { status: 400 })

  let out
  try {
    out = await claudeJson({
      database, scope: 'draft', scopeId: id, stage: 'structuring',
      model: SONNET_MODEL, maxTokens: 8000,
      skipCostCap: true,
      systemPrompt: STRUCTURE_SYSTEM,
      userPrompt: buildStructurePrompt({
        title: draft.title ?? '',
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        bodyMarkdown: draft.bodyMarkdown,
      }),
      parse: parseStructure,
    })
  } catch (err) {
    return NextResponse.json({
      error: 'Structuring failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  const structured = out.result
  // Strip fabricated internal links against the live sitemap.
  let removedLinks = 0
  let removedCompetitors = 0
  try {
    const ctx = await loadBlogContext()
    const sani = sanitizeInternalLinks(structured.bodyMarkdownClean, linkableUrlSet(ctx))
    structured.bodyMarkdownClean = sani.markdown
    removedLinks = sani.removed.length
  } catch { /* leave links as-is if context unavailable */ }
  const compSani = sanitizeCompetitorLinks(structured.bodyMarkdownClean)
  structured.bodyMarkdownClean = compSani.markdown
  removedCompetitors = compSani.removed.length
  const cleanHtml = markdownToHtml(structured.bodyMarkdownClean)
  const takeawaysHtml = structured.keyTakeaways.length > 0
    ? `<ul>${structured.keyTakeaways.map(t => `<li>${escapeHtmlText(t)}</li>`).join('')}</ul>`
    : null
  const now = new Date().toISOString()
  let sb: Record<string, unknown> = {}
  try { sb = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  sb.faqHeading = structured.faqSectionHeading
  await database.update(schema.contentDrafts).set({
    bodyHtml: cleanHtml,
    bodyMarkdown: structured.bodyMarkdownClean,
    faqsJson: JSON.stringify(structured.faqs),
    keyTakeaways: takeawaysHtml,
    summary: structured.summary || null,
    postExcerpt: structured.postExcerpt || null,
    shortenedName: structured.shortenedName || null,
    metaTitle: structured.metaTitle || draft.metaTitle || null,
    metaDescription: structured.metaDescription || draft.metaDescription || null,
    scoreBreakdown: JSON.stringify(sb),
    updatedAt: now,
  }).where(eq(schema.contentDrafts.id, id))

  // Write the final sanitised body as a new revision so the preview shows
  // exactly what ships + what the link gate checked (not a stale earlier
  // revision with fabricated links).
  const revs = await database
    .select({ n: schema.draftRevisions.revisionNumber })
    .from(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, id))
  const finalRev = revs.length === 0 ? 1 : Math.max(...revs.map(r => r.n)) + 1
  await database.insert(schema.draftRevisions).values({
    id: crypto.randomUUID(),
    draftId: id,
    revisionNumber: finalRev,
    source: 'structured_final',
    bodyHtml: cleanHtml,
    bodyMarkdown: structured.bodyMarkdownClean,
    wordCount: structured.bodyMarkdownClean.split(/\s+/).filter(Boolean).length,
    reason: 'Final body: FAQ/takeaways split out, fabricated links stripped',
    createdAt: now,
    updatedAt: now,
  })

  // Close the category + schema + hreflang gaps and run the final link
  // gate (HTTP-check every link for 200).
  let finalize
  try {
    finalize = await finalizeWebflowFields(database, id)
  } catch (err) {
    console.error('finalizeWebflowFields failed in restructure', err)
  }

  return NextResponse.json({
    faqCount: structured.faqs.length,
    takeawayCount: structured.keyTakeaways.length,
    metaTitle: structured.metaTitle,
    fabricatedLinksRemoved: removedLinks,
    competitorLinksRemoved: removedCompetitors,
    category: finalize?.mainCategorySlug ?? null,
    schemaValid: finalize?.schemaValid ?? null,
    schemaErrors: finalize?.schemaErrors ?? [],
    deadLinks: finalize?.linkCheck.dead ?? [],
    costCents: out.costCents,
  })
}
