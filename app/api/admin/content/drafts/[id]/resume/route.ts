/**
 * POST /api/admin/content/drafts/[id]/resume
 *
 * Resumes a paused draft. Restores status to paused_from_status so the
 * orchestrator picks up exactly where it left off — no completed stages
 * are re-run. Clears paused_from_status + the stage lock.
 *
 * Contract:
 *   POST -> { draftId, status }   // status = the restored stage
 *   400 if the draft isn't paused
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
      pausedFromStatus: schema.contentDrafts.pausedFromStatus,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.status !== 'paused') {
    return NextResponse.json({ error: `Draft is not paused (status "${draft.status}").` }, { status: 400 })
  }

  // Fall back to 'queued' if we somehow lost the stashed stage.
  const restore = draft.pausedFromStatus ?? 'queued'

  await database.update(schema.contentDrafts).set({
    status: restore,
    pausedFromStatus: null,
    stageLockedAt: null,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ draftId: id, status: restore })
}
