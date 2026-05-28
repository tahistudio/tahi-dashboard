/**
 * Round-table orchestrator — Phase I · Slice 9.
 *
 * Multi-stage state machine that drives a draft from `queued` to
 * `ready_for_publish`. Each stage is a discrete `runStage` call so the
 * orchestrator can be driven by either a cron loop or front-end polling.
 * Designed to fit inside the Cloudflare Workers per-request CPU budget.
 *
 * Stage map:
 *   queued                  → researching   (Perplexity 5 queries)
 *   researching             → strategising  (Opus brief)
 *   strategising            → headline_lab  (Sonnet 3-way)
 *   headline_lab            → drafting      (Sonnet writes)
 *   drafting                → reviewing     (20+ Sonnet reviewers parallel)
 *   reviewing               → editing       (Opus merges)
 *   editing                 → reviewing     (loop if hard_fail, max 3 times)
 *   editing (passes gates)  → signing_off   (Opus reads fresh)
 *   signing_off             → covering      (Flux via Replicate)
 *   covering                → ready_for_publish
 *
 * The orchestrator never publishes. ready_for_publish drafts wait for
 * Liam's manual approval in the Conflicts UI + Publish action.
 *
 * All stages record their cost to ai_cost_log and check the per-draft
 * $10 cap before starting. A capped draft is moved to `cost_capped`
 * status with an estimate of what completion would have cost.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { claudeJson, CostCapExceededError } from '@/lib/anthropic-cost'
import { getDraftSpendCents, recordCost, DRAFT_COST_CAP_CENTS, ESTIMATED_STAGE_COSTS_CENTS } from '@/lib/ai-cost'
import { buildResearchBrief, isPerplexityConfigured } from '@/lib/perplexity'
import { generateCover, isReplicateConfigured } from '@/lib/replicate'
import { validateDraftLinks } from '@/lib/link-validator'
import { markdownToHtml } from '@/lib/markdown-render'
import { loadBlogContext, renderBlogContextForPrompt, linkableUrlSet, sanitizeInternalLinks } from '@/lib/blog-context'
import { finalizeWebflowFields } from '@/lib/blog-finalize'
import {
  REVIEWERS,
  DEFAULT_VOICE_WEIGHTS,
  type ReviewerKey,
  type ReviewerCritique,
  type ReviewerContext,
} from '@/lib/round-table-reviewers'
import {
  STRATEGIST_SYSTEM,
  HEADLINE_LAB_SYSTEM,
  WRITER_SYSTEM,
  EDITOR_SYSTEM,
  SIGN_OFF_SYSTEM,
  buildStrategistPrompt,
  buildHeadlineLabPrompt,
  buildWriterPrompt,
  buildEditorPrompt,
  buildSignOffPrompt,
  STRUCTURE_SYSTEM,
  buildStructurePrompt,
  parseStrategist,
  parseHeadlineLab,
  parseWriter,
  parseEditor,
  parseSignOff,
  parseStructure,
  type StrategistOutput,
} from '@/lib/round-table-leads'

type Database = Awaited<ReturnType<typeof db>>

export type DraftStatus =
  | 'queued'
  | 'researching'
  | 'strategising'
  | 'headline_lab'
  | 'drafting'
  | 'reviewing'
  | 'editing'
  | 'signing_off'
  | 'covering'
  | 'ready_for_publish'
  | 'cost_capped'
  | 'failed'

const MAX_EDIT_LOOPS = 3
// Whole-article sign-off bar. 85 = only genuinely good drafts pass; the
// 3-revision cap above means a draft that can't reach it gets flagged to
// Liam rather than looping forever.
const SIGN_OFF_PASS_SCORE = 85

export interface StageResult {
  nextStatus: DraftStatus
  costCentsThisStage: number
  totalCostCents: number
  message?: string
}

/** Drive the draft forward by one stage. Idempotent — calling repeatedly
 *  from queued advances stage-by-stage. The status read at the top of
 *  the function is the source of truth. */
export async function runStage(database: Database, draftId: string): Promise<StageResult> {
  const draft = await loadDraft(database, draftId)
  if (!draft) throw new Error(`Draft ${draftId} not found`)

  // Concurrency guard. If another runStage call claimed this draft in the
  // last 90s, bail — otherwise overlapping cron ticks + front-end polls
  // run the same stage twice and double-insert reviewer rows. Best-effort
  // (read-check-set, not a true mutex), which covers the realistic
  // cron-plus-poll overlap window.
  if (draft.stageLockedAt) {
    const lockedMs = Date.parse(draft.stageLockedAt)
    if (!Number.isNaN(lockedMs) && Date.now() - lockedMs < 90_000) {
      const spentNow = await getDraftSpendCents(database, draftId)
      return {
        nextStatus: draft.status as DraftStatus,
        costCentsThisStage: 0,
        totalCostCents: spentNow,
        message: 'Stage already in progress (locked); skipping concurrent run.',
      }
    }
  }
  // Claim the lock.
  await database.update(schema.contentDrafts)
    .set({ stageLockedAt: new Date().toISOString() })
    .where(eq(schema.contentDrafts.id, draftId))

  // Hard cap check before doing any work
  const spent = await getDraftSpendCents(database, draftId)
  if (spent >= DRAFT_COST_CAP_CENTS) {
    await setStatus(database, draftId, 'cost_capped',
      `Cost cap of $${(DRAFT_COST_CAP_CENTS / 100).toFixed(2)} reached. Spent: $${(spent / 100).toFixed(2)}.`)
    return {
      nextStatus: 'cost_capped',
      costCentsThisStage: 0,
      totalCostCents: spent,
      message: `Cost cap reached. Estimated remaining stages would have cost ~$${(estimateRemainingCents(draft.status as DraftStatus) / 100).toFixed(2)}.`,
    }
  }

  // Status convention: each value names the CURRENT stage (the one we're
  // about to run, or the one that's running). When a stage finishes,
  // `advance()` sets status to the NEXT stage name. So when status is
  // 'strategising', that means "research is done, Strategist is next".
  try {
    switch (draft.status) {
      case 'queued':            return await stageResearch(database, draft)
      case 'researching':       return await stageResearch(database, draft)      // resume if interrupted
      case 'strategising':      return await stageStrategise(database, draft)
      case 'headline_lab':      return await stageHeadlineLab(database, draft)
      case 'drafting':          return await stageDraft(database, draft)
      case 'reviewing':         return await stageReview(database, draft)
      case 'editing':           return await stageEdit(database, draft)
      case 'signing_off':       return await stageCover(database, draft)         // sign-off + cover combined
      case 'covering':          return await stageReadyForPublish(database, draft)
      case 'ready_for_publish': return { nextStatus: 'ready_for_publish', costCentsThisStage: 0, totalCostCents: spent, message: 'Already ready.' }
      case 'cost_capped':       return { nextStatus: 'cost_capped', costCentsThisStage: 0, totalCostCents: spent, message: 'Cost cap reached.' }
      case 'failed':            return { nextStatus: 'failed', costCentsThisStage: 0, totalCostCents: spent, message: 'Draft failed.' }
      default:
        throw new Error(`Unknown status: ${draft.status}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const terminal = err instanceof CostCapExceededError ? 'cost_capped' : 'failed'
    // Clear the lock on terminal failure so a retry can re-claim cleanly.
    await database.update(schema.contentDrafts)
      .set({ status: terminal, errorMessage: message, stageLockedAt: null })
      .where(eq(schema.contentDrafts.id, draftId))
    return { nextStatus: terminal, costCentsThisStage: 0, totalCostCents: spent, message }
  }
}

// ── Stage implementations ────────────────────────────────────────────────────

async function stageResearch(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'researching')
  const idea = await loadIdea(database, draft.ideaId)
  if (!idea) throw new Error('Idea not found for draft')

  const topic = idea.title ?? 'Webflow agency content'
  const brief = await buildResearchBrief(topic, idea.angle ?? undefined)

  // Cost record for Perplexity (estimate via usage)
  const cents = await recordCost(database, {
    scope: 'draft', scopeId: draft.id, stage: 'perplexity_research',
    provider: 'perplexity', model: 'sonar-pro',
    inputTokens: brief.totalUsage.inputTokens, outputTokens: brief.totalUsage.outputTokens,
    note: brief.mocked ? 'mocked (no PERPLEXITY_API_KEY)' : `${brief.allCitations.length} citations`,
  })

  await database.update(schema.contentDrafts).set({
    researchSummary: JSON.stringify(brief),
    validatedCitations: JSON.stringify(brief.allCitations),
  }).where(eq(schema.contentDrafts.id, draft.id))

  return advance(database, draft.id, 'strategising', cents)
}

async function stageStrategise(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'strategising')
  const idea = await loadIdea(database, draft.ideaId)
  if (!idea) throw new Error('Idea not found')
  const research = JSON.parse(draft.researchSummary ?? '{}') as Awaited<ReturnType<typeof buildResearchBrief>>

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'strategist',
    model: 'claude-opus-4-7', maxTokens: 3500,
    systemPrompt: STRATEGIST_SYSTEM,
    userPrompt: buildStrategistPrompt({
      workingTitle: idea.title ?? 'Untitled',
      cluster: idea.clusterId ?? 'unknown',
      targetKeyword: idea.targetKeyword ?? idea.title ?? '',
      researchBrief: research,
      defaultVoiceWeights: {},
    }),
    parse: parseStrategist,
  })

  // Apply default weights for this intent, then layer Strategist overrides on top.
  const effectiveWeights = { ...(DEFAULT_VOICE_WEIGHTS[result.intent] ?? {}), ...result.voiceWeights }

  await database.update(schema.contentDrafts).set({
    title: result.workingTitle,
    metaTitle: result.workingTitle,
    postType: result.intent,
    scoreBreakdown: JSON.stringify({ brief: result, voiceWeights: effectiveWeights }),
  }).where(eq(schema.contentDrafts.id, draft.id))

  return advance(database, draft.id, 'headline_lab', costCents)
}

async function stageHeadlineLab(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'headline_lab')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'headline_lab',
    model: 'claude-sonnet-4-6', maxTokens: 1500,
    systemPrompt: HEADLINE_LAB_SYSTEM,
    userPrompt: buildHeadlineLabPrompt({
      workingTitle: brief.workingTitle,
      angle: brief.angle,
      primaryKeyword: brief.primaryKeyword,
      intent: brief.intent,
    }),
    parse: parseHeadlineLab,
  })

  const picked = result.finalists[result.recommendation] ?? result.finalists[0]
  await database.update(schema.contentDrafts).set({
    title: picked.title,
    metaTitle: picked.metaTitle,
    metaDescription: picked.metaDescription,
  }).where(eq(schema.contentDrafts.id, draft.id))

  return advance(database, draft.id, 'drafting', costCents)
}

async function stageDraft(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'drafting')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')
  const research = JSON.parse(draft.researchSummary ?? '{}') as Awaited<ReturnType<typeof buildResearchBrief>>

  // Pull live blog context (slugs + recent posts) so the writer links
  // accurately, relatively (/slug), and knows what we've already covered.
  let blogContextBlock = ''
  try {
    blogContextBlock = renderBlogContextForPrompt(await loadBlogContext())
  } catch { /* non-fatal — writer falls back to no internal-link list */ }

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'writer',
    model: 'claude-sonnet-4-6', maxTokens: 8000,
    systemPrompt: WRITER_SYSTEM,
    userPrompt: buildWriterPrompt({ brief, researchBrief: research, blogContext: blogContextBlock }),
    parse: parseWriter,
  })

  // Render HTML from the markdown the writer produced (markdown-only
  // output keeps the JSON from truncating on long articles).
  const writerHtml = markdownToHtml(result.bodyMarkdown)

  // Compute the next revision number rather than hardcoding 1, so a
  // re-drafted draft (e.g. after retry) doesn't pile multiple rows at
  // revision 1 and confuse latestRevisionNumber.
  const writerRev = (await latestRevisionNumber(database, draft.id)) + 1
  await database.insert(schema.draftRevisions).values({
    id: crypto.randomUUID(),
    draftId: draft.id,
    revisionNumber: writerRev,
    source: 'writer_initial',
    bodyHtml: writerHtml,
    bodyMarkdown: result.bodyMarkdown,
    wordCount: result.wordCount,
    reason: 'first draft from writer',
  })
  await database.update(schema.contentDrafts).set({
    bodyHtml: writerHtml,
    bodyMarkdown: result.bodyMarkdown,
  }).where(eq(schema.contentDrafts.id, draft.id))

  return advance(database, draft.id, 'reviewing', costCents)
}

async function stageReview(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'reviewing')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')

  // Determine which revision we're reviewing
  const latestRev = await latestRevisionNumber(database, draft.id)

  // Validate outbound links upfront — citations reviewer needs this
  const validation = await validateDraftLinks(draft.bodyHtml ?? '')
  const validatedLinks = {
    ok: validation.valid.map(l => ({ url: l.url })),
    broken: validation.invalid.map(l => ({ url: l.url, reason: l.reason })),
  }

  const reviewerCtx: ReviewerContext = {
    draftId: draft.id,
    revisionNumber: latestRev,
    title: draft.title ?? '',
    metaDescription: draft.metaDescription ?? '',
    bodyHtml: draft.bodyHtml ?? '',
    bodyMarkdown: draft.bodyMarkdown ?? '',
    brief: {
      intent: brief.intent,
      targetWordCount: brief.targetWordCount,
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: brief.secondaryKeywords,
      schemaTypes: brief.schemaTypes,
      voiceWeights: getVoiceWeights(draft),
    },
    validatedLinks,
  }

  // Resumable reviewing. Low Anthropic tiers cap output at 8k tokens/min,
  // so 23 reviewers can't all run in one worker request without 429s +
  // blowing the wall-clock budget. We instead run only the reviewers that
  // don't yet have a row for this revision, time-boxed per call, in small
  // chunks. If reviewers remain when the budget is hit, we leave status
  // at 'reviewing' (clearing the lock) so the next advance/cron call
  // resumes. Only once all 23 are in do we advance to 'editing'.
  const doneRows = await database
    .select({ reviewerKey: schema.draftReviews.reviewerKey })
    .from(schema.draftReviews)
    .where(and(
      eq(schema.draftReviews.draftId, draft.id),
      eq(schema.draftReviews.revisionNumber, latestRev),
    ))
  const doneKeys = new Set(doneRows.map(r => r.reviewerKey))
  const remaining = REVIEWERS.filter(r => !doneKeys.has(r.key))

  let totalCents = 0
  const CHUNK_SIZE = 3
  const INTER_CHUNK_MS = 4_000
  const REVIEW_BUDGET_MS = 90_000  // per-call wall-clock budget for this stage
  const t0 = Date.now()
  let processedThisCall = 0

  for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
    if (Date.now() - t0 > REVIEW_BUDGET_MS) break
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CHUNK_MS))
    const chunk = remaining.slice(i, i + CHUNK_SIZE)
    await Promise.all(chunk.map(async (reviewer) => {
      const start = Date.now()
      try {
        const weight = reviewerCtx.brief.voiceWeights[reviewer.key] ?? reviewer.defaultWeight
        const { result, costCents } = await claudeJson({
          database, scope: 'draft', scopeId: draft.id, stage: reviewer.key,
          // 2500: enough headroom that a thorough critique (strengths +
          // issues + details) doesn't truncate, without ballooning the
          // per-minute output budget on a low tier.
          model: reviewer.model, maxTokens: 2500,
          systemPrompt: reviewer.systemPrompt,
          userPrompt: reviewer.buildUserPrompt(reviewerCtx),
          parse: (raw: string) => JSON.parse(raw) as ReviewerCritique,
        })
        totalCents += costCents
        await database.insert(schema.draftReviews).values({
          id: crypto.randomUUID(),
          draftId: draft.id,
          revisionNumber: latestRev,
          reviewerKey: reviewer.key,
          score: result.score,
          verdict: result.verdict,
          summary: result.summary,
          critique: JSON.stringify(result),
          weight: String(weight),
          durationMs: Date.now() - start,
        })
      } catch (err) {
        // Don't fail the whole stage if one reviewer errors — log it and
        // continue with the others.
        await database.insert(schema.draftReviews).values({
          id: crypto.randomUUID(),
          draftId: draft.id,
          revisionNumber: latestRev,
          reviewerKey: reviewer.key,
          score: null,
          verdict: 'soft_fail',
          summary: `Reviewer errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
          critique: null,
          weight: String(reviewer.defaultWeight),
          durationMs: Date.now() - start,
        })
      }
    }))
    processedThisCall += chunk.length
  }

  // How many reviewers are done now (across all calls)?
  const totalDone = doneKeys.size + processedThisCall
  if (totalDone >= REVIEWERS.length) {
    return advance(database, draft.id, 'editing', totalCents)
  }

  // More reviewers remain. Stay at 'reviewing', clear the lock so the next
  // advance/cron tick resumes from here.
  await database.update(schema.contentDrafts)
    .set({ stageLockedAt: null })
    .where(eq(schema.contentDrafts.id, draft.id))
  const total = await getDraftSpendCents(database, draft.id)
  return {
    nextStatus: 'reviewing',
    costCentsThisStage: totalCents,
    totalCostCents: total,
    message: `Reviewed ${totalDone}/${REVIEWERS.length}; resuming next tick.`,
  }
}

async function stageEdit(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'editing')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')
  const latestRev = await latestRevisionNumber(database, draft.id)
  const reviews = await database
    .select()
    .from(schema.draftReviews)
    .where(and(
      eq(schema.draftReviews.draftId, draft.id),
      eq(schema.draftReviews.revisionNumber, latestRev),
    ))

  // Dedupe by reviewerKey (keep the last critique per reviewer). Belt
  // and braces against any double-insert that slipped past the lock.
  const byReviewer = new Map<string, typeof reviews[number]>()
  for (const r of reviews) {
    if (r.critique != null) byReviewer.set(r.reviewerKey, r)
  }
  const reviewsForEditor = Array.from(byReviewer.values()).map(r => ({
    reviewerKey: r.reviewerKey as ReviewerKey,
    weight: parseFloat(r.weight ?? '1'),
    critique: JSON.parse(r.critique ?? '{}') as ReviewerCritique,
  }))

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'editor',
    model: 'claude-opus-4-7', maxTokens: 8000,
    systemPrompt: EDITOR_SYSTEM,
    userPrompt: buildEditorPrompt({
      brief,
      currentBodyMarkdown: draft.bodyMarkdown ?? '',
      currentBodyHtml: draft.bodyHtml ?? '',
      reviews: reviewsForEditor,
    }),
    parse: parseEditor,
  })

  // Render HTML from the editor's markdown.
  const editedHtml = markdownToHtml(result.bodyMarkdown)

  // Store the new revision
  const nextRev = latestRev + 1
  await database.insert(schema.draftRevisions).values({
    id: crypto.randomUUID(),
    draftId: draft.id,
    revisionNumber: nextRev,
    source: 'editor_merge',
    bodyHtml: editedHtml,
    bodyMarkdown: result.bodyMarkdown,
    wordCount: estimateWordCount(result.bodyMarkdown),
    reason: result.changesSummary,
  })
  await database.update(schema.contentDrafts).set({
    bodyHtml: editedHtml,
    bodyMarkdown: result.bodyMarkdown,
    contentScore: result.weightedScore,
  }).where(eq(schema.contentDrafts.id, draft.id))

  // Log conflict resolutions
  for (const c of result.conflictResolutions) {
    await database.insert(schema.editorOverrides).values({
      id: crypto.randomUUID(),
      draftId: draft.id,
      reviewerA: c.reviewerA,
      reviewerB: c.reviewerB,
      topic: c.topic,
      editorPicked: c.picked,
      editorReasoning: c.reasoning,
    })
  }

  // Check whether any veto-capable reviewer hard-failed. If so, we loop
  // back to reviewing the NEW revision (up to MAX_EDIT_LOOPS).
  const vetoFailed = reviewsForEditor.some(r => {
    const reviewer = REVIEWERS.find(rev => rev.key === r.reviewerKey)
    return reviewer?.vetoCapable && r.critique.verdict === 'hard_fail'
  })

  if (vetoFailed && nextRev <= MAX_EDIT_LOOPS + 1) {
    return advance(database, draft.id, 'reviewing', costCents,
      `Veto reviewer hard-failed; looping for revision ${nextRev + 1} (cap ${MAX_EDIT_LOOPS}).`)
  }
  return advance(database, draft.id, 'signing_off', costCents)
}

async function stageReviewOrSignOff(_database: Database, draft: DraftRow): Promise<StageResult> {
  // The editor advances either to reviewing (loop) or signing_off. This
  // case is unreachable in normal flow but here for safety.
  return { nextStatus: draft.status as DraftStatus, costCentsThisStage: 0, totalCostCents: 0 }
}

async function stageCover(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'signing_off')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'signoff',
    model: 'claude-opus-4-7', maxTokens: 1500,
    systemPrompt: SIGN_OFF_SYSTEM,
    userPrompt: buildSignOffPrompt({
      brief,
      bodyMarkdown: draft.bodyMarkdown ?? '',
      editorWeightedScore: draft.contentScore ?? 0,
    }),
    parse: parseSignOff,
  })

  // If sign-off fails, mark as failed for Liam to review manually
  if (result.score < SIGN_OFF_PASS_SCORE) {
    await setStatus(database, draft.id, 'failed',
      `Sign-off score ${result.score} < ${SIGN_OFF_PASS_SCORE}. Notes: ${result.finalNotes}`)
    return { nextStatus: 'failed', costCentsThisStage: costCents, totalCostCents: await getDraftSpendCents(database, draft.id) }
  }

  await database.update(schema.contentDrafts).set({
    contentScore: result.score,
  }).where(eq(schema.contentDrafts.id, draft.id))

  // Structure the draft into discrete Webflow CMS fields so the publish
  // step lands each piece in the right field (clean post-body without the
  // FAQ/takeaways sections, separate FAQ pairs, key takeaways, meta). This
  // is what makes "the Webflow draft work without issues".
  let structureCents = 0
  try {
    const reloaded = await loadDraft(database, draft.id)
    const bodyMd = reloaded?.bodyMarkdown ?? draft.bodyMarkdown ?? ''
    const { result: structured, costCents: sCents } = await claudeJson({
      database, scope: 'draft', scopeId: draft.id, stage: 'structuring',
      model: 'claude-sonnet-4-6', maxTokens: 8000,
      systemPrompt: STRUCTURE_SYSTEM,
      userPrompt: buildStructurePrompt({
        title: reloaded?.title ?? draft.title ?? '',
        metaTitle: reloaded?.metaTitle ?? null,
        metaDescription: reloaded?.metaDescription ?? null,
        bodyMarkdown: bodyMd,
      }),
      parse: parseStructure,
    })
    structureCents = sCents
    // Strip any fabricated internal links before the body can reach
    // Webflow — only links to genuinely live pages survive.
    let cleanMarkdown = structured.bodyMarkdownClean
    try {
      const ctx = await loadBlogContext()
      const sani = sanitizeInternalLinks(cleanMarkdown, linkableUrlSet(ctx))
      cleanMarkdown = sani.markdown
      if (sani.removed.length > 0) {
        console.warn(`Stripped ${sani.removed.length} fabricated internal links from draft ${draft.id}`)
      }
    } catch { /* if context unavailable, leave links as-is */ }
    structured.bodyMarkdownClean = cleanMarkdown
    const cleanHtml = markdownToHtml(structured.bodyMarkdownClean)
    const takeawaysHtml = structured.keyTakeaways.length > 0
      ? `<ul>${structured.keyTakeaways.map(t => `<li>${escapeHtmlText(t)}</li>`).join('')}</ul>`
      : null
    // Stash the FAQ section heading in scoreBreakdown (no migration).
    let sb: Record<string, unknown> = {}
    try { sb = JSON.parse(reloaded?.scoreBreakdown ?? draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
    sb.faqHeading = structured.faqSectionHeading
    await database.update(schema.contentDrafts).set({
      bodyHtml: cleanHtml,
      bodyMarkdown: structured.bodyMarkdownClean,
      faqsJson: JSON.stringify(structured.faqs),
      keyTakeaways: takeawaysHtml,
      summary: structured.summary || null,
      postExcerpt: structured.postExcerpt || null,
      shortenedName: structured.shortenedName || null,
      metaTitle: structured.metaTitle || reloaded?.metaTitle || null,
      metaDescription: structured.metaDescription || reloaded?.metaDescription || null,
      authorSlug: 'liam',
      scoreBreakdown: JSON.stringify(sb),
    }).where(eq(schema.contentDrafts.id, draft.id))
  } catch (err) {
    // Non-fatal — the body still publishes, just without the field split.
    console.error('Structuring failed', err)
  }

  // Close the remaining Webflow field gaps: map category, generate +
  // validate JSON-LD schema, build hreflang. Non-fatal.
  try {
    await finalizeWebflowFields(database, draft.id)
  } catch (err) {
    console.error('finalizeWebflowFields failed', err)
  }

  // Cover generation. NOTE: Flux is being replaced by an SVG generator
  // (covers are abstract on-brand illustrations, no text). Kept behind the
  // stub for now; the SVG generator lands in a follow-up.
  let coverCents = 0
  try {
    const cover = await generateCover(result.recommendCover)
    coverCents = await recordCost(database, {
      scope: 'draft', scopeId: draft.id, stage: 'flux_cover',
      provider: 'replicate', model: 'black-forest-labs/flux-1.1-pro',
      callUnits: 1,
      note: cover.mocked ? 'mocked (no REPLICATE_API_TOKEN)' : `prediction ${cover.predictionId}`,
    })
    await database.update(schema.contentDrafts).set({
      coverSvgUrl: cover.url,           // bitmap URL; column kept this name from prior slice
      coverTemplate: cover.mocked ? 'mock' : 'flux-1.1-pro',
    }).where(eq(schema.contentDrafts.id, draft.id))
  } catch (err) {
    // Cover failure is non-fatal — leave coverSvgUrl null, Liam can
    // regenerate from the UI.
    console.error('Cover generation failed', err)
  }

  return advance(database, draft.id, 'ready_for_publish', costCents + structureCents + coverCents)
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function stageReadyForPublish(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'ready_for_publish')
  const spent = await getDraftSpendCents(database, draft.id)
  return { nextStatus: 'ready_for_publish', costCentsThisStage: 0, totalCostCents: spent, message: 'Awaiting Liam approval to publish.' }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DraftRow {
  id: string
  ideaId: string
  status: string
  bodyHtml: string | null
  bodyMarkdown: string | null
  title: string | null
  metaTitle: string | null
  metaDescription: string | null
  researchSummary: string | null
  scoreBreakdown: string | null
  contentScore: number | null
  stageLockedAt: string | null
}

async function loadDraft(database: Database, id: string): Promise<DraftRow | null> {
  const [row] = await database
    .select({
      id: schema.contentDrafts.id,
      ideaId: schema.contentDrafts.ideaId,
      status: schema.contentDrafts.status,
      bodyHtml: schema.contentDrafts.bodyHtml,
      bodyMarkdown: schema.contentDrafts.bodyMarkdown,
      title: schema.contentDrafts.title,
      metaTitle: schema.contentDrafts.metaTitle,
      metaDescription: schema.contentDrafts.metaDescription,
      researchSummary: schema.contentDrafts.researchSummary,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
      contentScore: schema.contentDrafts.contentScore,
      stageLockedAt: schema.contentDrafts.stageLockedAt,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  return row ?? null
}

interface IdeaRow {
  id: string
  title: string | null
  angle: string | null
  targetKeyword: string | null
  clusterId: string | null
}

async function loadIdea(database: Database, id: string): Promise<IdeaRow | null> {
  const [row] = await database
    .select({
      id: schema.contentIdeas.id,
      title: schema.contentIdeas.title,
      angle: schema.contentIdeas.angle,
      targetKeyword: schema.contentIdeas.targetKeyword,
      clusterId: schema.contentIdeas.clusterId,
    })
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, id))
    .limit(1)
  return row ?? null
}

function getBrief(draft: DraftRow): StrategistOutput | null {
  if (!draft.scoreBreakdown) return null
  try {
    const parsed = JSON.parse(draft.scoreBreakdown) as { brief?: StrategistOutput }
    return parsed.brief ?? null
  } catch {
    return null
  }
}

function getVoiceWeights(draft: DraftRow): Partial<Record<ReviewerKey, number>> {
  if (!draft.scoreBreakdown) return {}
  try {
    const parsed = JSON.parse(draft.scoreBreakdown) as { voiceWeights?: Partial<Record<ReviewerKey, number>> }
    return parsed.voiceWeights ?? {}
  } catch {
    return {}
  }
}

async function latestRevisionNumber(database: Database, draftId: string): Promise<number> {
  const rows = await database
    .select({ n: schema.draftRevisions.revisionNumber })
    .from(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, draftId))
  if (rows.length === 0) return 0
  return Math.max(...rows.map(r => r.n))
}

async function setStatus(database: Database, draftId: string, status: DraftStatus, errorMessage?: string): Promise<void> {
  await database.update(schema.contentDrafts).set({
    status,
    errorMessage: errorMessage ?? null,
  }).where(eq(schema.contentDrafts.id, draftId))
}

async function advance(database: Database, draftId: string, next: DraftStatus, cents: number, message?: string): Promise<StageResult> {
  // Clear the concurrency lock as we transition to the next stage so the
  // next runStage call (cron or poll) can claim it cleanly.
  await database.update(schema.contentDrafts)
    .set({ status: next, errorMessage: null, stageLockedAt: null })
    .where(eq(schema.contentDrafts.id, draftId))
  const total = await getDraftSpendCents(database, draftId)
  return { nextStatus: next, costCentsThisStage: cents, totalCostCents: total, message }
}

function estimateWordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length
}

function estimateRemainingCents(currentStatus: DraftStatus): number {
  const stagesAhead: Record<DraftStatus, string[]> = {
    queued: ['perplexity_research', 'strategist', 'headline_lab', 'writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    researching: ['strategist', 'headline_lab', 'writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    strategising: ['headline_lab', 'writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    headline_lab: ['writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    drafting: ['reviewer_default', 'editor', 'signoff', 'flux_cover'],
    reviewing: ['editor', 'signoff', 'flux_cover'],
    editing: ['signoff', 'flux_cover'],
    signing_off: ['flux_cover'],
    covering: [],
    ready_for_publish: [],
    cost_capped: [],
    failed: [],
  }
  const stages = stagesAhead[currentStatus] ?? []
  return stages.reduce((sum, s) => {
    if (s === 'reviewer_default') {
      // 23 reviewers
      return sum + 23 * (ESTIMATED_STAGE_COSTS_CENTS[s] ?? 3)
    }
    return sum + (ESTIMATED_STAGE_COSTS_CENTS[s] ?? 5)
  }, 0)
}

/** Status banner for the UI — flags which stub APIs would skip real
 *  work so Liam knows whether the draft is "real" or "mocked end-to-end". */
export function checkServiceStatus(): {
  perplexity: boolean
  replicate: boolean
  openai: boolean
  anthropic: boolean
} {
  return {
    perplexity: isPerplexityConfigured(),
    replicate: isReplicateConfigured(),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  }
}
