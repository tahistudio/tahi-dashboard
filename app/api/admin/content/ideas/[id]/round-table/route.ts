/**
 * POST /api/admin/content/ideas/[id]/round-table
 *
 * Creates a content_drafts row for the idea (status='queued') and
 * immediately advances it through the first stage of the round-table
 * pipeline. The front-end then polls /api/admin/content/drafts/[id]/advance
 * (or the cron picks it up) until ready_for_publish.
 *
 * Contract:
 *   POST -> { draftId, status, message }
 *     400 if idea has no title
 *     409 if there's already an active draft for this idea
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray } from 'drizzle-orm'
import { runStage } from '@/lib/round-table'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = [
  'queued', 'researching', 'strategising', 'headline_lab',
  'drafting', 'reviewing', 'editing', 'signing_off', 'covering',
  'ready_for_publish',
] as const

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing idea id' }, { status: 400 })

  const database = await db()

  const [idea] = await database
    .select({
      id: schema.contentIdeas.id,
      title: schema.contentIdeas.title,
    })
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, id))
    .limit(1)
  if (!idea) return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  if (!idea.title) return NextResponse.json({ error: 'Idea has no title' }, { status: 400 })

  // Check for an active draft already on this idea
  const existing = await database
    .select({ id: schema.contentDrafts.id, status: schema.contentDrafts.status })
    .from(schema.contentDrafts)
    .where(and(
      eq(schema.contentDrafts.ideaId, id),
      inArray(schema.contentDrafts.status, ACTIVE_STATUSES as unknown as string[]),
    ))
    .limit(1)
  if (existing.length > 0) {
    return NextResponse.json({
      error: 'Active draft already exists for this idea',
      draftId: existing[0].id,
      status: existing[0].status,
    }, { status: 409 })
  }

  // Create the draft
  const draftId = crypto.randomUUID()
  await database.insert(schema.contentDrafts).values({
    id: draftId,
    ideaId: id,
    status: 'queued',
  })

  // Flip the idea to 'drafted' so it doesn't show in the proposed slate
  await database.update(schema.contentIdeas).set({
    status: 'drafted',
  }).where(eq(schema.contentIdeas.id, id))

  // Kick off the first stage so the user sees immediate progress
  const result = await runStage(database, draftId)

  return NextResponse.json({
    draftId,
    status: result.nextStatus,
    totalCostCents: result.totalCostCents,
    message: result.message ?? 'Round table started. Poll /api/admin/content/drafts/[id]/advance to continue.',
  })
}
