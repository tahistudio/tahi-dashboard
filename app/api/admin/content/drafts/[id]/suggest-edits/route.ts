/**
 * POST /api/admin/content/drafts/[id]/suggest-edits
 *
 * Liam's manual edit pass — a guardrailed, surgical final edit. He passes
 * specific instructions ("cut paragraph 3", "punch up the intro"); an Opus
 * call applies ONLY those changes and returns the full body + a changelog
 * of exactly what it touched. Saves a new revision tagged 'liam_edit' so
 * history is preserved and he can diff against the prior version.
 *
 * Only meaningful once a draft has a body (status editing onward, or
 * ready_for_publish). The body it edits is the current contentDrafts.bodyMarkdown.
 *
 * Contract:
 *   POST { instructions: string }
 *     -> { revisionNumber, changeLog: string[], skipped: [{instruction, reason}], costCents }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { claudeJson } from '@/lib/anthropic-cost'
import { markdownToHtml } from '@/lib/markdown-render'
import { LIAM_EDIT_SYSTEM, buildLiamEditPrompt, parseLiamEdit } from '@/lib/round-table-leads'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { instructions?: string }
  const instructions = body.instructions?.trim()
  if (!instructions) return NextResponse.json({ error: 'instructions are required' }, { status: 400 })

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      bodyMarkdown: schema.contentDrafts.bodyMarkdown,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (!draft.bodyMarkdown) {
    return NextResponse.json({ error: 'Draft has no body yet — let the pipeline finish drafting first.' }, { status: 400 })
  }

  let result
  try {
    const out = await claudeJson({
      database, scope: 'draft', scopeId: id, stage: 'liam_edit',
      model: 'claude-opus-4-7', maxTokens: 8000,
      skipCostCap: true,  // manual edits are Liam-initiated; don't let the per-article cap block them
      systemPrompt: LIAM_EDIT_SYSTEM,
      userPrompt: buildLiamEditPrompt({ currentBodyMarkdown: draft.bodyMarkdown, instructions }),
      parse: parseLiamEdit,
    })
    result = out
  } catch (err) {
    return NextResponse.json({
      error: 'Edit pass failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  // Next revision number.
  const revs = await database
    .select({ n: schema.draftRevisions.revisionNumber })
    .from(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, id))
  const nextRev = revs.length === 0 ? 1 : Math.max(...revs.map(r => r.n)) + 1

  const editedHtml = markdownToHtml(result.result.bodyMarkdown)
  const now = new Date().toISOString()
  await database.insert(schema.draftRevisions).values({
    id: crypto.randomUUID(),
    draftId: id,
    revisionNumber: nextRev,
    source: 'liam_edit',
    bodyHtml: editedHtml,
    bodyMarkdown: result.result.bodyMarkdown,
    wordCount: result.result.bodyMarkdown.split(/\s+/).filter(Boolean).length,
    reason: `Manual edit: ${instructions.slice(0, 200)}`,
    createdAt: now,
    updatedAt: now,
  })
  await database.update(schema.contentDrafts).set({
    bodyHtml: editedHtml,
    bodyMarkdown: result.result.bodyMarkdown,
    updatedAt: now,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({
    revisionNumber: nextRev,
    changeLog: result.result.changeLog,
    skipped: result.result.skipped,
    costCents: result.costCents,
  })
}
