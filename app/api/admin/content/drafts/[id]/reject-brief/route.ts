/**
 * POST /api/admin/content/drafts/[id]/reject-brief
 *
 * Rejects the strategist's brief and sends the draft back to
 * 'strategising' so a fresh strategist pass runs next tick. Optional
 * `feedback` body field is stashed on scoreBreakdown.briefRejectionNote
 * so the next strategist call can read it and adjust.
 *
 * Contract:
 *   POST { feedback?: string } -> { ok, nextStatus }
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

  const body = (await req.json().catch(() => ({}))) as { feedback?: string }
  const feedback = body.feedback?.trim() ?? ''

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      status: schema.contentDrafts.status,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.status !== 'awaiting_brief_approval') {
    return NextResponse.json({
      error: `Brief can only be rejected while awaiting approval (current: ${draft.status}).`,
    }, { status: 409 })
  }

  let sb: Record<string, unknown> = {}
  try { sb = JSON.parse(draft.scoreBreakdown ?? '{}') } catch { /* keep empty */ }
  if (feedback) sb.briefRejectionNote = feedback

  await database.update(schema.contentDrafts).set({
    status: 'strategising',
    stageLockedAt: null,
    errorMessage: null,
    scoreBreakdown: JSON.stringify(sb),
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ ok: true, nextStatus: 'strategising' })
}
