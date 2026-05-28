/**
 * GET /api/admin/content/drafts/[id]
 *
 * Single draft + linked idea + cluster. Used by the SlideOver preview
 * on /content-studio Drafts tab.
 *
 * DELETE /api/admin/content/drafts/[id]
 *
 * Discards a draft: deletes the row + flips the idea's status back to
 * 'approved' so it can be re-drafted later. The cron's auto-drafter
 * picks it up on the next tick (currently disabled by default).
 *
 * Contract (GET):
 *   { draft: DraftRow, idea: ContentIdea | null, cluster: ContentCluster | null }
 *
 * Contract (DELETE):
 *   { success: true }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const database = await db()

  const [draft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  let idea: typeof schema.contentIdeas.$inferSelect | null = null
  let cluster: typeof schema.contentClusters.$inferSelect | null = null

  const [ideaRow] = await database
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, draft.ideaId))
    .limit(1)
  if (ideaRow) {
    idea = ideaRow
    if (ideaRow.clusterId) {
      const [clusterRow] = await database
        .select()
        .from(schema.contentClusters)
        .where(eq(schema.contentClusters.id, ideaRow.clusterId))
        .limit(1)
      if (clusterRow) cluster = clusterRow
    }
  }

  return NextResponse.json({ draft, idea, cluster })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const database = await db()
  const [existing] = await database
    .select({ id: schema.contentDrafts.id, ideaId: schema.contentDrafts.ideaId })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  // Flip idea back to approved so Liam can re-draft from a clean slate.
  const now = new Date().toISOString()
  await database
    .update(schema.contentIdeas)
    .set({ status: 'approved', updatedAt: now })
    .where(eq(schema.contentIdeas.id, existing.ideaId))

  await database
    .delete(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ success: true })
}
