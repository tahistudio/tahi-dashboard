/**
 * POST /api/admin/content/drafts/[id]/approve-brief
 *
 * Human-gate approval of the strategist's brief. Advances the draft from
 * 'awaiting_brief_approval' to 'headline_lab' so the auto-tick picks up
 * + walks the rest of the pipeline (headline lab -> writer -> reviewers
 * -> editor -> sign-off -> cover).
 *
 * Contract:
 *   POST -> { ok, nextStatus }
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
    .select({ id: schema.contentDrafts.id, status: schema.contentDrafts.status })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.status !== 'awaiting_brief_approval') {
    return NextResponse.json({
      error: `Brief can only be approved while awaiting approval (current: ${draft.status}).`,
    }, { status: 409 })
  }

  await database.update(schema.contentDrafts).set({
    status: 'headline_lab',
    stageLockedAt: null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ ok: true, nextStatus: 'headline_lab' })
}
