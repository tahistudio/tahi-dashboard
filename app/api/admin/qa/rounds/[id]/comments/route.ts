import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { loadRound, targetOrigin } from '@/lib/qa/server'
import { groupNotes, numberComments, toCommentDetail } from '@/lib/qa/comments'
import type { QaCommentDetail, QaTarget } from '@/lib/qa/types'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Every element comment in a round with the detail needed to fix it without
 * seeing the screen. ?status=open (default), resolved or all. Ordered by page
 * sort order, then pin number. Pin numbers count every comment on the page,
 * resolved or not, so they match the pins in the workspace.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const statusParam = req.nextUrl.searchParams.get('status') ?? 'open'
  if (statusParam !== 'open' && statusParam !== 'resolved' && statusParam !== 'all') {
    return NextResponse.json({ error: "status must be 'open', 'resolved' or 'all'" }, { status: 400 })
  }

  const { id } = await params
  const database = await db() as Drizzle
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // One join, so the number of round pages never reaches a bound-parameter limit.
  const joined = await database
    .select({
      comment: schema.qaComments,
      path: schema.qaRoundPages.path,
      sortOrder: schema.qaRoundPages.sortOrder,
    })
    .from(schema.qaComments)
    .innerJoin(schema.qaRoundPages, eq(schema.qaComments.roundPageId, schema.qaRoundPages.id))
    .where(eq(schema.qaRoundPages.roundId, loaded.round.id))

  const numbers = numberComments(joined.map(j => j.comment))
  const noteRows = await database
    .select({ note: schema.qaCommentNotes })
    .from(schema.qaCommentNotes)
    .innerJoin(schema.qaComments, eq(schema.qaCommentNotes.commentId, schema.qaComments.id))
    .innerJoin(schema.qaRoundPages, eq(schema.qaComments.roundPageId, schema.qaRoundPages.id))
    .where(eq(schema.qaRoundPages.roundId, loaded.round.id))
  const notesByComment = groupNotes(noteRows.map(r => r.note))
  const target: QaTarget = loaded.round.target === 'live' ? 'live' : 'staging'
  const detailContext = {
    roundId: loaded.round.id,
    roundName: loaded.round.name,
    siteName: loaded.site.name,
    target,
    siteUrl: targetOrigin(loaded.site, target),
  }

  const comments: QaCommentDetail[] = joined
    .filter(j => statusParam === 'all' || j.comment.status === statusParam)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      if (a.path !== b.path) return a.path < b.path ? -1 : 1
      return (numbers.get(a.comment.id) ?? 0) - (numbers.get(b.comment.id) ?? 0)
    })
    .map(j => toCommentDetail(j.comment, numbers.get(j.comment.id) ?? 0, j.path, detailContext, notesByComment.get(j.comment.id) ?? []))

  return NextResponse.json({
    round: { id: loaded.round.id, name: loaded.round.name, target },
    site: {
      id: loaded.site.id,
      name: loaded.site.name,
      stagingUrl: loaded.site.stagingUrl,
      liveUrl: loaded.site.liveUrl,
    },
    comments,
  })
}
