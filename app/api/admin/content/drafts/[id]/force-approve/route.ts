/**
 * POST /api/admin/content/drafts/[id]/force-approve
 *
 * Manual override for sign-off failures. Clears the failed-status +
 * error message and pushes the draft to 'covering', so the next
 * runStage tick generates the cover + finalises + lands at
 * ready_for_publish. Sign-off is SKIPPED on this path — the human is
 * the gate.
 *
 * Guards:
 *   - draft must be status='failed'
 *   - the error message must come from sign-off (so we don't force-pass
 *     a draft that died for some other reason like a missing brief)
 *
 * The sign-off score + notes are preserved on scoreBreakdown.forcedPast
 * so we can audit how often Liam overrides + tune the threshold later.
 *
 * Contract:
 *   POST -> { ok: true, prevScore, prevNotes }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      status: schema.contentDrafts.status,
      errorMessage: schema.contentDrafts.errorMessage,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
      contentScore: schema.contentDrafts.contentScore,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  if (draft.status !== 'failed') {
    return NextResponse.json({
      error: `Force-approve only applies to failed drafts (current: ${draft.status})`,
    }, { status: 409 })
  }
  if (!draft.errorMessage || !draft.errorMessage.includes('Sign-off score')) {
    return NextResponse.json({
      error: 'Force-approve only handles sign-off failures. This draft failed for another reason.',
      currentError: draft.errorMessage,
    }, { status: 409 })
  }

  let sb: Record<string, unknown> = {}
  try { sb = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  sb.forcedPastSignoff = {
    at: new Date().toISOString(),
    prevScore: draft.contentScore,
    prevError: draft.errorMessage,
  }

  await database.update(schema.contentDrafts).set({
    status: 'covering',
    errorMessage: null,
    stageLockedAt: null,
    scoreBreakdown: JSON.stringify(sb),
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({
    ok: true,
    prevScore: draft.contentScore,
    prevError: draft.errorMessage,
  })
}
