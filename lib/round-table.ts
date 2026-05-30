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

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { claudeJson, CostCapExceededError } from '@/lib/anthropic-cost'
import { OPUS_MODEL, SONNET_MODEL } from '@/lib/ai-models'
import { getDraftSpendCents, recordCost, DRAFT_COST_CAP_CENTS, ESTIMATED_STAGE_COSTS_CENTS } from '@/lib/ai-cost'
import { buildResearchBrief, isPerplexityConfigured } from '@/lib/perplexity'
import { generateCover, isReplicateConfigured } from '@/lib/replicate'
import { validateDraftLinks } from '@/lib/link-validator'
import { markdownToHtml } from '@/lib/markdown-render'
import { loadBlogContext, renderBlogContextForPrompt, linkableUrlSet, sanitizeInternalLinks, sanitizeCompetitorLinks } from '@/lib/blog-context'
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
  | 'awaiting_brief_approval'   // human gate: Liam reviews the strategist brief before $4 of writer + 23 reviewers spend
  | 'headline_lab'
  | 'drafting'
  | 'reviewing'
  | 'editing'
  | 'signing_off'
  | 'covering'
  | 'ready_for_publish'
  | 'audited'              // legacy audit shadow drafts terminate here with score + critiques
  | 'cost_capped'
  | 'failed'

const MAX_EDIT_LOOPS = 3
// Whole-article sign-off bar. 85 = only genuinely good drafts pass; the
// 3-revision cap above means a draft that can't reach it gets flagged to
// Liam rather than looping forever.
// Lowered 85 -> 78 on 2026-05-29. 85 is too tight — the first article hit
// 86 by a hair and good 78-84s were getting rejected over single-criterion
// concerns. The force-approve route is the escape hatch for borderline
// cases the model over-penalises.
const SIGN_OFF_PASS_SCORE = 78

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
      case 'awaiting_brief_approval':
        // Human gate. Nothing to do until Liam approves/rejects via
        // /api/admin/content/drafts/[id]/approve-brief | reject-brief.
        return { nextStatus: 'awaiting_brief_approval', costCentsThisStage: 0, totalCostCents: spent, message: 'Awaiting brief approval (human gate).' }
      case 'headline_lab':      return await stageHeadlineLab(database, draft)
      case 'drafting':          return await stageDraft(database, draft)
      case 'reviewing':         return await stageReview(database, draft)
      case 'editing':           return await stageEdit(database, draft)
      case 'signing_off':       return await stageCover(database, draft)         // sign-off + cover combined
      case 'covering':          return await stageReadyForPublish(database, draft)
      case 'ready_for_publish': return { nextStatus: 'ready_for_publish', costCentsThisStage: 0, totalCostCents: spent, message: 'Already ready.' }
      case 'audited':           return { nextStatus: 'audited', costCentsThisStage: 0, totalCostCents: spent, message: 'Audit complete. Score + critiques are stashed; pick Apply improvements to PATCH Webflow.' }
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

  // Drop competitor-agency citations before they reach the writer.
  // Perplexity loves citing big well-known agency posts; we don't want
  // those becoming our writer's authoritative source (or worse, ending
  // up linked in the body). Products + official docs + standards stay.
  const { filterOutCompetitors } = await import('./blog-competitor-domains')
  const filtered = filterOutCompetitors(brief.allCitations)
  brief.allCitations = filtered.kept

  // Cost record for Perplexity (estimate via usage)
  const cents = await recordCost(database, {
    scope: 'draft', scopeId: draft.id, stage: 'perplexity_research',
    provider: 'perplexity', model: 'sonar-pro',
    inputTokens: brief.totalUsage.inputTokens, outputTokens: brief.totalUsage.outputTokens,
    note: brief.mocked
      ? 'mocked (no PERPLEXITY_API_KEY)'
      : `${brief.allCitations.length} citations${filtered.dropped.length > 0 ? ` (${filtered.dropped.length} competitor agencies stripped)` : ''}`,
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

  // If the human rejected a previous brief, pull the note through so the
  // re-strategist call addresses it. Cleared after consumption so we
  // don't re-apply it on subsequent passes.
  let rejectionFeedback: string | null = null
  let sb: Record<string, unknown> = {}
  try { sb = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  if (typeof sb.briefRejectionNote === 'string' && sb.briefRejectionNote.trim()) {
    rejectionFeedback = sb.briefRejectionNote
    delete sb.briefRejectionNote
  }

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'strategist',
    model: OPUS_MODEL, maxTokens: 3500,
    systemPrompt: STRATEGIST_SYSTEM,
    userPrompt: buildStrategistPrompt({
      workingTitle: idea.title ?? 'Untitled',
      cluster: idea.clusterId ?? 'unknown',
      targetKeyword: idea.targetKeyword ?? idea.title ?? '',
      researchBrief: research,
      defaultVoiceWeights: {},
      rejectionFeedback,
    }),
    parse: parseStrategist,
  })

  // Three layers, last wins: intent defaults < content-bucket overlay
  // (generic/novel/data) < strategist's explicit per-article weights.
  // Bucket overlays operationalise the 70/20/10 mix — originality is
  // strict on novel, citations + numeric_claims strict on data, etc.
  const { BUCKET_VOICE_WEIGHTS } = await import('@/lib/round-table-reviewers')
  const effectiveWeights = {
    ...(DEFAULT_VOICE_WEIGHTS[result.intent] ?? {}),
    ...(BUCKET_VOICE_WEIGHTS[result.contentBucket] ?? {}),
    ...result.voiceWeights,
  }

  await database.update(schema.contentDrafts).set({
    title: result.workingTitle,
    metaTitle: result.workingTitle,
    postType: result.intent,
    // Persist the strategist's author pick so the writer, structuring step,
    // schema generation, and Webflow publish payload all use the same byline.
    authorSlug: result.author,
    scoreBreakdown: JSON.stringify({ brief: result, voiceWeights: effectiveWeights }),
  }).where(eq(schema.contentDrafts.id, draft.id))

  // Legacy audits skip the human brief gate + the headline lab + the
  // writer — the body already exists. Jump straight to reviewing.
  if (isAudit(draft)) {
    return advance(database, draft.id, 'reviewing', costCents)
  }

  // Pause for human brief approval instead of auto-advancing to the
  // headline lab. The auto-tick respects awaiting_brief_approval as
  // terminal-ish (see TERMINAL_STATUSES in the detail UI), so the draft
  // sits here until Liam clicks Approve (advances to headline_lab) or
  // Reject (sends back to researching for a fresh strategist pass).
  return advance(database, draft.id, 'awaiting_brief_approval', costCents)
}

async function stageHeadlineLab(database: Database, draft: DraftRow): Promise<StageResult> {
  await setStatus(database, draft.id, 'headline_lab')
  const brief = getBrief(draft)
  if (!brief) throw new Error('Brief not found')

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'headline_lab',
    model: SONNET_MODEL, maxTokens: 1500,
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

  // Load the voice stack from Docs Hub: Tahi tone of voice (base) +
  // author-specific overlay (Liam or Staci per the strategist's pick) +
  // AI Writing Tells (anti-patterns to avoid). Strategist persists the
  // author choice to draft.authorSlug; default to liam if unset.
  const author = (draft.authorSlug === 'staci' ? 'staci' : 'liam') as 'liam' | 'staci'
  const { loadAiContextDocs } = await import('@/lib/ai-context')
  const docs = await loadAiContextDocs([
    'tone', author === 'staci' ? 'staciVoice' : 'liamVoice', 'aiTells',
  ])
  const brandDocs = [
    docs.tone && `=== TAHI TONE OF VOICE (base layer — applies to every Tahi article) ===\n${docs.tone}`,
    (author === 'staci' ? docs.staciVoice : docs.liamVoice) &&
      `=== ${author === 'staci' ? 'STACI' : 'LIAM'}'S PERSONAL VOICE (overlay — write THIS article in this person's voice) ===\n${author === 'staci' ? docs.staciVoice : docs.liamVoice}`,
    docs.aiTells && `=== AI WRITING TELLS (anti-patterns to AVOID — do not use these phrasings) ===\n${docs.aiTells}`,
  ].filter(Boolean).join('\n\n')

  const { result, costCents } = await claudeJson({
    database, scope: 'draft', scopeId: draft.id, stage: 'writer',
    model: SONNET_MODEL, maxTokens: 8000,
    systemPrompt: WRITER_SYSTEM,
    userPrompt: buildWriterPrompt({ brief, researchBrief: research, blogContext: blogContextBlock, brandDocs }),
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
      contentBucket: brief.contentBucket,
      author: brief.author,
      whatsNetNew: brief.whatsNetNew,
      operatorAnecdote: brief.operatorAnecdote,
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
  // Tahi is on the upgraded Anthropic tier (1000 RPM, 450K input tokens/min
  // Sonnet) as of 2026-05-29. Old throttling (CHUNK_SIZE 3 + 4s inter-chunk)
  // was tuned for the previous tier and bottlenecked the pipeline. Now we
  // can run 8 reviewers per chunk with a 500ms breather, which drains all 23
  // in 3 chunks (≈30-50s) instead of stretching across multiple ticks.
  const CHUNK_SIZE = 8
  const INTER_CHUNK_MS = 500
  const REVIEW_BUDGET_MS = 120_000  // per-call wall-clock budget for this stage
  const t0 = Date.now()
  let processedThisCall = 0

  for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
    if (Date.now() - t0 > REVIEW_BUDGET_MS) break
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CHUNK_MS))
    const chunk = remaining.slice(i, i + CHUNK_SIZE)
    // Per-reviewer block MUST NEVER throw. If it does, Promise.all
    // rejects, the for-loop breaks, processedThisCall doesn't tick, and
    // the next auto-tick re-runs the SAME reviewers — a $1+ leak per
    // cycle. So every awaited call is wrapped in try/catch with a final
    // never-throw fallback insert.
    await Promise.all(chunk.map(async (reviewer) => {
      const start = Date.now()

      // Race guard: another tick might have just written this row.
      try {
        const existing = await database
          .select({ id: schema.draftReviews.id })
          .from(schema.draftReviews)
          .where(and(
            eq(schema.draftReviews.draftId, draft.id),
            eq(schema.draftReviews.revisionNumber, latestRev),
            eq(schema.draftReviews.reviewerKey, reviewer.key),
          ))
          .limit(1)
        if (existing.length > 0) return
      } catch { /* fall through; worst case we double-insert one row */ }

      try {
        const weight = reviewerCtx.brief.voiceWeights[reviewer.key] ?? reviewer.defaultWeight
        const { result, costCents } = await claudeJson({
          database, scope: 'draft', scopeId: draft.id, stage: reviewer.key,
          model: reviewer.model, maxTokens: 2500,
          systemPrompt: reviewer.systemPrompt,
          userPrompt: reviewer.buildUserPrompt(reviewerCtx),
          parse: (raw: string) => JSON.parse(raw) as ReviewerCritique,
        })
        totalCents += costCents
        try {
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
          return
        } catch (insertErr) {
          // Success-path insert failed (rare). Fall through to soft-fail
          // insert below so the row exists + we never retry.
          console.error(`reviewer ${reviewer.key} success insert failed`, insertErr)
        }
      } catch (err) {
        console.warn(`reviewer ${reviewer.key} errored`,
          err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200))
      }

      // Last-resort soft-fail row. Two attempts; if both fail we swallow
      // so processedThisCall still ticks and the chunk loop moves on.
      const softFailRow = {
        id: crypto.randomUUID(),
        draftId: draft.id,
        revisionNumber: latestRev,
        reviewerKey: reviewer.key,
        score: null,
        verdict: 'soft_fail' as const,
        summary: 'Reviewer skipped (retry exhausted)',
        critique: null,
        weight: String(reviewer.defaultWeight),
        durationMs: Date.now() - start,
      }
      try {
        await database.insert(schema.draftReviews).values(softFailRow)
      } catch (firstFail) {
        try {
          await database.insert(schema.draftReviews).values({ ...softFailRow, id: crypto.randomUUID() })
        } catch (secondFail) {
          console.error(`reviewer ${reviewer.key} double-failure; swallowing to avoid loop`, firstFail, secondFail)
        }
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
    model: OPUS_MODEL, maxTokens: 8000,
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
    scoreBreakdown: JSON.stringify({
      ...(() => {
        try { return JSON.parse(draft.scoreBreakdown ?? '{}') } catch { return {} }
      })(),
      bucketScores: computeBucketScores(reviewsForEditor.map(r => ({ key: r.reviewerKey, score: r.critique.score }))),
    }),
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
    model: OPUS_MODEL, maxTokens: 1500,
    systemPrompt: SIGN_OFF_SYSTEM,
    userPrompt: buildSignOffPrompt({
      brief,
      bodyMarkdown: draft.bodyMarkdown ?? '',
      editorWeightedScore: draft.contentScore ?? 0,
    }),
    parse: parseSignOff,
  })

  // Legacy audits land at 'audited' regardless of score — the score IS
  // the output of an audit. No "fail" path; the critiques explain what
  // the score reflects. No structuring + no cover generation either:
  // Webflow already has the post live, we're just evaluating it.
  if (isAudit(draft)) {
    let sbAudit: Record<string, unknown> = {}
    try { sbAudit = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* empty */ }
    sbAudit.signoffNotes = result.finalNotes
    sbAudit.signoffScore = result.score
    sbAudit.recommendCover = result.recommendCover  // surfaced if Liam applies improvements + wants a cover refresh later
    // Compute the 4-bucket display the Drafts list expects from the
    // stored audit reviewer rows. Use the highest revisionNumber that
    // actually has reviewer rows — the latest draft_revisions row may
    // be a post-editor revision with zero reviews.
    try {
      const [auditMaxRev] = await database
        .select({ maxN: sql<number>`MAX(${schema.draftReviews.revisionNumber})` })
        .from(schema.draftReviews)
        .where(eq(schema.draftReviews.draftId, draft.id))
      if (auditMaxRev?.maxN != null) {
        const auditReviews = await database
          .select({ reviewerKey: schema.draftReviews.reviewerKey, score: schema.draftReviews.score })
          .from(schema.draftReviews)
          .where(and(
            eq(schema.draftReviews.draftId, draft.id),
            eq(schema.draftReviews.revisionNumber, auditMaxRev.maxN),
          ))
        sbAudit.bucketScores = computeBucketScores(auditReviews.map(r => ({ key: r.reviewerKey, score: r.score })))
      }
    } catch { /* bucket scores best-effort */ }
    await database.update(schema.contentDrafts).set({
      status: 'audited',
      contentScore: result.score,
      scoreBreakdown: JSON.stringify(sbAudit),
      stageLockedAt: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.contentDrafts.id, draft.id))
    return {
      nextStatus: 'audited',
      costCentsThisStage: costCents,
      totalCostCents: await getDraftSpendCents(database, draft.id),
      message: `Audit complete. Score ${result.score}/100.`,
    }
  }

  // If sign-off fails, mark as failed for Liam to review manually
  if (result.score < SIGN_OFF_PASS_SCORE) {
    await setStatus(database, draft.id, 'failed',
      `Sign-off score ${result.score} < ${SIGN_OFF_PASS_SCORE}. Notes: ${result.finalNotes}`)
    return { nextStatus: 'failed', costCentsThisStage: costCents, totalCostCents: await getDraftSpendCents(database, draft.id) }
  }

  // Stash the cover prompt in scoreBreakdown so the Slack handoff to
  // Staci can use it without a fresh AI call.
  let sbForCover: Record<string, unknown> = {}
  try { sbForCover = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  sbForCover.recommendCover = result.recommendCover
  await database.update(schema.contentDrafts).set({
    contentScore: result.score,
    scoreBreakdown: JSON.stringify(sbForCover),
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
      model: SONNET_MODEL, maxTokens: 8000,
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
    // Also strip links to competitor agencies. Text is preserved, only
    // the link wrapper is removed so we don't send readers off to a rival.
    const compSani = sanitizeCompetitorLinks(cleanMarkdown)
    cleanMarkdown = compSani.markdown
    if (compSani.removed.length > 0) {
      console.warn(`Stripped ${compSani.removed.length} competitor-agency links from draft ${draft.id}`)
    }
    // Deterministic AI-tell sanitizer — hard-blocks Tier 1 banned words
    // (delve, leverage, robust, em-dash etc) that leaked past the
    // probabilistic LLM reviewers. Catches what the writer + editor
    // didn't. Source list = AI Writing Tells doc.
    try {
      const { sanitizeAiTells } = await import('@/lib/ai-tell-sanitizer')
      const aiSani = sanitizeAiTells(cleanMarkdown)
      cleanMarkdown = aiSani.markdown
      if (aiSani.totalChanges > 0) {
        console.log(`Stripped ${aiSani.totalChanges} AI tells from draft ${draft.id}: ${aiSani.stripped.length} pattern strips, ${aiSani.replacements.length} word swaps`)
      }
    } catch (err) { console.error('AI tell sanitize failed', err) }

    // Strip any H1 the writer slipped in. The post title is the page's
    // H1, set by the Webflow template — a body H1 would render a second
    // H1 and break heading hierarchy. Downgrade leading H1s to H2 so we
    // don't lose the content if the writer used H1 for a real section.
    const h1Count = (cleanMarkdown.match(/^#\s/gm) ?? []).length
    if (h1Count > 0) {
      cleanMarkdown = cleanMarkdown.replace(/^#\s+/gm, '## ')
      console.log(`Downgraded ${h1Count} H1 heading(s) to H2 in draft ${draft.id}`)
    }

    // Auto-link first-mention of every live glossary term to its term
    // page. This is the Investopedia mechanic — over time every term
    // page accumulates inbound internal PageRank from every article
    // that mentions it. Source of truth is the site_index table.
    try {
      const glossaryRows = await database
        .select({ url: schema.siteIndex.url, relativeUrl: schema.siteIndex.relativeUrl, title: schema.siteIndex.title })
        .from(schema.siteIndex)
        .where(and(eq(schema.siteIndex.isActive, 1), eq(schema.siteIndex.type, 'glossary')))
      const glossaryTerms = glossaryRows
        .filter(r => r.title)
        .map(r => ({ term: r.title!, url: r.relativeUrl }))
      const { autoLinkGlossary } = await import('@/lib/blog-context')
      const glossLinked = autoLinkGlossary(cleanMarkdown, glossaryTerms)
      cleanMarkdown = glossLinked.markdown
      if (glossLinked.linked.length > 0) {
        console.log(`Auto-linked ${glossLinked.linked.length} glossary terms in draft ${draft.id}`)
      }
    } catch { /* site_index empty / not migrated — skip */ }
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
      // Don't overwrite authorSlug here — strategist already set it
      // based on the topic. Keep whatever the strategist picked.
      scoreBreakdown: JSON.stringify({ ...sb, aiPrompt: structured.aiPrompt }),
    }).where(eq(schema.contentDrafts.id, draft.id))

    // Write the final, sanitised body as a new revision so the preview's
    // latest revision == what ships == what the link gate checks. Without
    // this the preview keeps showing the editor's pre-sanitise revision
    // (with the stripped-out fabricated links still visible).
    const finalRev = (await latestRevisionNumber(database, draft.id)) + 1
    await database.insert(schema.draftRevisions).values({
      id: crypto.randomUUID(),
      draftId: draft.id,
      revisionNumber: finalRev,
      source: 'structured_final',
      bodyHtml: cleanHtml,
      bodyMarkdown: structured.bodyMarkdownClean,
      wordCount: estimateWordCount(structured.bodyMarkdownClean),
      reason: 'Final body: FAQ/takeaways split out, fabricated links stripped',
    })
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
  authorSlug: string | null
  originSource: string | null
  auditTargetWebflowId: string | null
}

function isAudit(draft: DraftRow): boolean {
  return draft.originSource === 'legacy_audit'
}

/**
 * Map the 23 reviewers into the 4 buckets the Drafts list UI displays
 * (AEO 25 / Voice 25 / Read 20 / SEO 20 — sums to 90 in the v1 UI). The
 * bucket score is the average of its reviewers' raw 0-100 scores, scaled
 * to the bucket's max so it reads as "X out of 25" etc.
 */
function computeBucketScores(reviews: Array<{ key: string; score: number | null | undefined }>): { aeo: number; voice: number; readability: number; seo: number } {
  const buckets: Record<'aeo' | 'voice' | 'readability' | 'seo', { keys: string[]; max: number }> = {
    aeo:        { keys: ['seo_aeo', 'featured_snippet', 'voice_search', 'citations', 'internal_links'], max: 25 },
    voice:      { keys: ['brand_tone', 'tahi_voice', 'anti_ai', 'hook', 'emotional_resonance'],         max: 25 },
    readability:{ keys: ['pacing', 'skim_test', 'mobile_reading', 'visual_layout'],                     max: 20 },
    seo:        { keys: ['originality', 'unique_angle', 'counter_argument', 'icp_reader', 'numeric_claims'], max: 20 },
  }
  const scoreByKey = new Map<string, number>()
  for (const r of reviews) {
    if (typeof r.score === 'number' && !Number.isNaN(r.score)) scoreByKey.set(r.key, r.score)
  }
  const out = { aeo: 0, voice: 0, readability: 0, seo: 0 }
  for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
    const def = buckets[k]
    const vals = def.keys.map(key => scoreByKey.get(key)).filter((v): v is number => typeof v === 'number')
    if (vals.length === 0) continue
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    out[k] = Math.round((avg / 100) * def.max)
  }
  return out
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
      authorSlug: schema.contentDrafts.authorSlug,
      originSource: schema.contentDrafts.originSource,
      auditTargetWebflowId: schema.contentDrafts.auditTargetWebflowId,
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
    awaiting_brief_approval: ['headline_lab', 'writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    headline_lab: ['writer', 'reviewer_default', 'editor', 'signoff', 'flux_cover'],
    drafting: ['reviewer_default', 'editor', 'signoff', 'flux_cover'],
    reviewing: ['editor', 'signoff', 'flux_cover'],
    editing: ['signoff', 'flux_cover'],
    signing_off: ['flux_cover'],
    covering: [],
    ready_for_publish: [],
    audited: [],
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
