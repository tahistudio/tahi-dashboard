import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { loadRoundPage } from '@/lib/qa/server'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Deletes one note from a comment thread. 409 when the round is closed. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id, noteId } = await params
  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const loaded = await loadRoundPage(database, existing.roundPageId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  const [note] = await database
    .select({ id: schema.qaCommentNotes.id })
    .from(schema.qaCommentNotes)
    .where(and(eq(schema.qaCommentNotes.id, noteId), eq(schema.qaCommentNotes.commentId, id)))
    .limit(1)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await database
    .delete(schema.qaCommentNotes)
    .where(and(eq(schema.qaCommentNotes.id, noteId), eq(schema.qaCommentNotes.commentId, id)))
  return NextResponse.json({ ok: true })
}
