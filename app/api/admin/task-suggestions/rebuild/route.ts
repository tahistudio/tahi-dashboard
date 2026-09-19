/**
 * POST /api/admin/task-suggestions/rebuild
 *
 * The cutover door for CN.1b, and the only way to make the sweep read a
 * transcript twice.
 *
 * The suggester is deliberately a one-shot: `call_transcripts.suggested_at`
 * is stamped on every transcript it has looked at (migration 0108), so a call
 * that yielded nothing, one the gate skipped and one the model failed on are
 * all never read again. That is the right default and it is exactly the wrong
 * thing on the day the vocabulary changes: the eight calls already swept were
 * read by a suggester that only knew about tasks, so every client deliverable
 * on them came out as a task, or as nothing.
 *
 * So this route un-reads them:
 *
 *   1. Every pending or snoozed suggestion from those transcripts goes to
 *      'expired', with the caller recorded as the decider. EXPIRED, not
 *      deleted: the row is the record of what the old prompt proposed, and a
 *      rejected row would be a lie about a human having looked at it.
 *      Applied and rejected rows are untouched, because those ARE decisions
 *      and re-proposing something a founder already turned down would be the
 *      inbox arguing with them.
 *   2. `suggested_at` is cleared on those transcripts, which is the whole
 *      mechanism: the next sweep finds them null and reads them again, now
 *      with the request kinds.
 *
 * Tahi admin only, and unscoped on purpose: this is a workspace-wide cutover
 * operation rather than a per-client one, so a team member scoped to a subset
 * of clients has no business half-clearing the queue. `isTahiAdmin` is the
 * gate the other cutover routes (the importers, the migration runner) use for
 * the same reason.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, inArray, isNotNull } from 'drizzle-orm'

/** Ids per IN clause. D1 caps bound parameters at 100 per statement. */
const ID_CHUNK = 90

function chunk<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += ID_CHUNK) out.push(items.slice(index, index + ID_CHUNK))
  return out
}

interface RebuildBody {
  transcriptIds?: unknown
  all?: unknown
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as RebuildBody

  const named = Array.isArray(body.transcriptIds)
    ? body.transcriptIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const all = body.all === true

  if (!all && named.length === 0) {
    return NextResponse.json(
      { error: 'Name transcriptIds, or pass all: true to rebuild every transcript' },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Which transcripts. `all` means every transcript that has actually been
  // read, not every row: clearing a null column on a transcript nobody has
  // swept yet changes nothing and would inflate the count the operator reads.
  let transcriptIds: string[]
  if (all) {
    const rows = await drizzle
      .select({ id: schema.callTranscripts.id })
      .from(schema.callTranscripts)
      .where(isNotNull(schema.callTranscripts.suggestedAt))
    transcriptIds = rows.map(row => row.id)
  } else {
    transcriptIds = Array.from(new Set(named))
  }

  if (transcriptIds.length === 0) {
    return NextResponse.json({ expired: 0, transcripts: 0 })
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let expired = 0

  for (const batch of chunk(transcriptIds)) {
    // Counted with a read before the write rather than off a D1 `changes`
    // result, so the number the operator sees is the number of rows this call
    // actually moved rather than whatever the driver reports.
    const open = await drizzle
      .select({ id: schema.taskSuggestions.id })
      .from(schema.taskSuggestions)
      .where(and(
        inArray(schema.taskSuggestions.transcriptId, batch),
        inArray(schema.taskSuggestions.status, ['pending', 'snoozed']),
      ))
    expired += open.length

    if (open.length > 0) {
      await drizzle
        .update(schema.taskSuggestions)
        .set({
          status: 'expired',
          snoozeUntil: null,
          decidedById: userId ?? null,
          decidedVia: 'dashboard',
          decidedAt: stamp,
          updatedAt: stamp,
        })
        .where(inArray(schema.taskSuggestions.id, open.map(row => row.id)))
    }

    // Last, and deliberately: a failure above must not leave the transcripts
    // clear with the old rows still pending, which would put the same
    // suggestion in the inbox twice.
    await drizzle
      .update(schema.callTranscripts)
      .set({ suggestedAt: null })
      .where(inArray(schema.callTranscripts.id, batch))
  }

  return NextResponse.json({ expired, transcripts: transcriptIds.length })
}
