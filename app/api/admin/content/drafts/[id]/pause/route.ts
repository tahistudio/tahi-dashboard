/**
 * POST /api/admin/content/drafts/[id]/pause
 *
 * Pauses a draft mid-pipeline. Stashes the current stage in
 * paused_from_status and flips status to 'paused' so the
 * round-table-advance cron skips it. Clears the stage lock so resume
 * starts cleanly.
 *
 * Only meaningful for in-flight drafts. Terminal statuses
 * (ready_for_publish, failed, cost_capped, paused) return 400.
 *
 * Contract:
 *   POST -> { draftId, status: 'paused', pausedFrom }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const ACTIVE = new Set([
  'queued', 'researching', 'strategising', 'headline_lab',
  'drafting', 'reviewing', 'editing', 'signing_off', 'covering',
])

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
  if (!ACTIVE.has(draft.status)) {
    return NextResponse.json({
      error: `Can't pause a draft in status "${draft.status}". Only in-flight drafts can be paused.`,
    }, { status: 400 })
  }

  await database.update(schema.contentDrafts).set({
    pausedFromStatus: draft.status,
    status: 'paused',
    stageLockedAt: null,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ draftId: id, status: 'paused', pausedFrom: draft.status })
}
