/**
 * POST /api/admin/content/drafts/[id]/retry
 *
 * Resets a failed / cost_capped draft to 'queued' so the orchestrator
 * can take another run at it. Body + brief from the previous attempt
 * are preserved; if the new run gets past the failing stage, the
 * existing revisions stay as history.
 *
 * Body { resetCost?: boolean }
 *   When true (default false), wipes the ai_cost_log rows for this draft
 *   so the per-article cap starts fresh. Use this when the previous
 *   failure was a transient issue (timeout, bad parse) rather than a
 *   genuine cap hit.
 *
 * Contract:
 *   POST -> { draftId, status: 'queued', message }
 *   400 if the draft isn't in a retry-eligible status
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const RETRY_ELIGIBLE = ['failed', 'cost_capped'] as const

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { resetCost?: boolean }

  const database = await db()
  const [draft] = await database
    .select({ id: schema.contentDrafts.id, status: schema.contentDrafts.status })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (!RETRY_ELIGIBLE.includes(draft.status as typeof RETRY_ELIGIBLE[number])) {
    return NextResponse.json({
      error: `Draft is in status "${draft.status}". Retry only allowed from: ${RETRY_ELIGIBLE.join(', ')}.`,
    }, { status: 400 })
  }

  // Optionally wipe cost log for this draft
  if (body.resetCost) {
    await database.delete(schema.aiCostLog).where(and(
      eq(schema.aiCostLog.scope, 'draft'),
      eq(schema.aiCostLog.scopeId, id),
    ))
  }

  await database.update(schema.contentDrafts).set({
    status: 'queued',
    errorMessage: null,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({
    draftId: id,
    status: 'queued',
    message: body.resetCost
      ? 'Reset to queued with cost log cleared.'
      : 'Reset to queued.',
  })
}
