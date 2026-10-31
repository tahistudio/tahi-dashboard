/**
 * GET  /api/admin/qa/comments/[id]/notes
 *      { notes } oldest first.
 * POST /api/admin/qa/comments/[id]/notes
 *      Body: { body: string (1..4000 after trimming), resolve?: boolean }.
 *      Adds a note to the comment thread. With resolve true the comment is also marked resolved in
 *      the same call (both writes in one batch). 409 when the round is closed or the thread already
 *      holds 100 notes (the cap is enforced inside the insert statement, so concurrent adds cannot pass it). Responds { note, comment }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { attributedUserId } from '@/lib/mcp-actor'
import { loadRoundPage } from '@/lib/qa/server'
import { QA_NOTES_PER_COMMENT_MAX } from '@/lib/qa/types'
import { groupNotes, parseNoteInput, rowToComment, rowToNote } from '@/lib/qa/comments'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** A note is at most 4000 characters, so 32 KB is generous. */
const NOTE_REQUEST_MAX_BYTES = 32 * 1024


async function loadNotes(database: Drizzle, commentId: string) {
  return database
    .select()
    .from(schema.qaCommentNotes)
    .where(eq(schema.qaCommentNotes.commentId, commentId))
    .orderBy(asc(schema.qaCommentNotes.createdAt), asc(schema.qaCommentNotes.id))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await loadNotes(database, id)
  return NextResponse.json({ notes: rows.map(rowToNote) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getRequestAuth(req)
  const { orgId, userId } = auth
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const text = await req.text().catch(() => '')
  if (new TextEncoder().encode(text).length > NOTE_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: 'Request body is too large' }, { status: 413 })
  }
  let raw: unknown = null
  try {
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }
  const parsed = parseNoteInput(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const loaded = await loadRoundPage(database, existing.roundPageId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  // The recorded author is the MCP person when one is verified, otherwise the signed-in member.
  const authorId = attributedUserId(auth)
  let authorName: string | null = null
  if (authorId) {
    const [member] = await database
      .select({ name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, authorId))
      .limit(1)
    authorName = member?.name ?? null
  }
  // 'mcp' only for a verified per-person envelope; the shared service token alone is 'service'.
  const source = auth.mcpActor ? 'mcp' : userId === 'api-service' ? 'service' : 'dashboard'

  const now = new Date().toISOString()
  // The cap lives inside the INSERT, so two adds at the same moment cannot both pass it.
  const noteId = crypto.randomUUID()
  const insertNote = database.run(sql`INSERT INTO qa_comment_notes (id, comment_id, body, author_id, author_name, source, created_at)
    SELECT ${noteId}, ${id}, ${parsed.value.body}, ${authorId}, ${authorName}, ${source}, ${now}
    WHERE (SELECT count(*) FROM qa_comment_notes WHERE comment_id = ${id}) < ${QA_NOTES_PER_COMMENT_MAX}`)

  if (parsed.value.resolve && existing.status !== 'resolved') {
    // One batch, so the note and the resolve land together or not at all. The resolve only applies
    // when the note row exists, so a refused note never resolves the comment.
    const resolveComment = database.run(sql`UPDATE qa_comments SET status = 'resolved', resolved_at = ${now}, updated_at = ${now}
      WHERE id = ${id} AND EXISTS (SELECT 1 FROM qa_comment_notes WHERE id = ${noteId})`)
    await database.batch([insertNote, resolveComment])
  } else {
    await insertNote
  }

  const [created] = await database.select().from(schema.qaCommentNotes).where(eq(schema.qaCommentNotes.id, noteId)).limit(1)
  if (!created) {
    return NextResponse.json(
      { error: `A comment can hold ${QA_NOTES_PER_COMMENT_MAX} notes. Delete one before adding another.` },
      { status: 409 },
    )
  }
  const [commentRow] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)

  const notes = groupNotes(await loadNotes(database, id)).get(id) ?? []
  return NextResponse.json({ note: rowToNote(created), comment: rowToComment(commentRow ?? existing, notes) }, { status: 201 })
}
