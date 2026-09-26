/**
 * POST /api/admin/task-suggestions/rebuild
 *
 * The only way to make the suggester read a transcript twice.
 *
 * The suggester is deliberately a one-shot: `call_transcripts.suggested_at`
 * is stamped on every transcript it has looked at (migration 0108), so a call
 * that yielded nothing, one the gate skipped and one the model failed on are
 * all never read again. That is the right default, and exactly the wrong one
 * on the day the vocabulary changes (CN.1b), or when a read plainly missed
 * something.
 *
 * A RE-READ MERGES, IT DOES NOT REPLACE (CN.1c). Sonnet 5 refuses a
 * temperature, so two reads of one call are two samples: the same three
 * Elevate calls gave five items one afternoon and none the next, and under
 * the old rule the second read expired the five before anybody saw them. So
 * by default this route expires NOTHING:
 *
 *   1. Every suggestion already filed from these transcripts stays exactly
 *      as it is. Pending and snoozed rows stay in the inbox; applied,
 *      rejected and failed rows are decisions and are never touched. The
 *      re-read ADDS what is new, and the writer (lib/task-suggestions.ts
 *      `insertSuggestions`) files nothing that repeats a row on file, in the
 *      same words (the dedupe key) or in new ones (`isRepeatOf`), so the
 *      union never shows one thing twice and never re-proposes something a
 *      founder already turned down.
 *   2. Rows an earlier rebuild expired while they still held their dedupe
 *      keys get the keys retired (the af5c2991 fix, kept), so an item one of
 *      them held can come back. Expired rows are also the one status the
 *      writer does not compare against, for the same reason.
 *   3. `suggested_at` is cleared, last, which is the whole mechanism.
 *
 * `replace: true` in the body, or `?replace=1`, is the escape hatch and the
 * only thing that still expires anything: every pending or snoozed row from
 * those transcripts goes to 'expired' (the caller recorded as the decider,
 * snooze alarms cleared, dedupe keys retired with the rows) before the mark
 * is cleared, so the re-read starts from nothing. EXPIRED, not deleted and
 * not rejected: the row is the record of what an old read proposed, and a
 * rejected row would be a lie about a human having looked at it. Meant for a
 * change to what the suggester knows how to propose, where the old rows are
 * wrong in kind rather than merely incomplete. Decided rows are untouched in
 * this mode too.
 *
 * THE RE-READ HAPPENS NOW, by default (`readNow`, on unless false): the
 * cleared transcripts are read straight away by lib/task-suggester.ts
 * `runSuggestionSweep` with `transcriptIds`, which ignores the sweep's thirty
 * day window (a call older than that would otherwise be cleared and never
 * read again), and the summary comes back as `read`. At most MAX_SWEEP_BATCH
 * (twenty) are read inline, oldest first for `all`; the rest are left
 * cleared for the scheduled sweep (reported as `deferred`), which reads
 * unread calls from the last thirty days. Each call is read twice, the
 * second time with the first read shown ("anything missed?"), unless the
 * body says `secondPass: false`. With `readNow: false` nothing is read here
 * and the next scheduled sweep reads them with its own default, which is
 * also both reads.
 *
 * Tahi admin only, and unscoped on purpose: this is a workspace-wide
 * operation rather than a per-client one, so a team member scoped to a
 * subset of clients has no business half-clearing the queue. `isTahiAdmin`
 * is the gate the other cutover routes (the importers, the migration runner)
 * use for the same reason.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, eq, inArray, isNotNull, notLike, sql } from 'drizzle-orm'
import { MAX_SWEEP_BATCH, runSuggestionSweep, type SweepSummary } from '@/lib/task-suggester'

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
  replace?: unknown
  secondPass?: unknown
  readNow?: unknown
}

/** `?replace=` values that mean yes. The query form exists for a person with curl. */
const YES = new Set(['1', 'true', 'yes'])

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
  const replace = body.replace === true
    || YES.has((new URL(req.url).searchParams.get('replace') ?? '').trim().toLowerCase())
  const mode = replace ? 'replace' : 'union'
  // Both on unless switched off by name. An absent flag and a flag the route
  // cannot read are the same answer: the safe default.
  const readNow = body.readNow !== false
  const secondPass = body.secondPass !== false

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
  // Oldest first, so the inline read below covers the calls closest to
  // falling out of the scheduled sweep's window.
  let transcriptIds: string[]
  if (all) {
    const rows = await drizzle
      .select({ id: schema.callTranscripts.id })
      .from(schema.callTranscripts)
      .where(isNotNull(schema.callTranscripts.suggestedAt))
      .orderBy(asc(schema.callTranscripts.receivedAt))
    transcriptIds = rows.map(row => row.id)
  } else {
    transcriptIds = Array.from(new Set(named))
  }

  if (transcriptIds.length === 0) {
    return NextResponse.json({ mode, expired: 0, kept: 0, transcripts: 0 })
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let expired = 0
  let kept = 0

  for (const batch of chunk(transcriptIds)) {
    // Counted with a read before any write rather than off a D1 `changes`
    // result, so the number the operator sees is the number of rows this call
    // actually moved (or left alone) rather than whatever the driver reports.
    const open = await drizzle
      .select({ id: schema.taskSuggestions.id })
      .from(schema.taskSuggestions)
      .where(and(
        inArray(schema.taskSuggestions.transcriptId, batch),
        inArray(schema.taskSuggestions.status, ['pending', 'snoozed']),
      ))

    if (!replace) {
      kept += open.length
    } else if (open.length > 0) {
      expired += open.length
      await drizzle
        .update(schema.taskSuggestions)
        .set({
          status: 'expired',
          // The key retires with the row: a re-read that proposes the same item
          // again must be able to insert it, and the unique index would
          // otherwise count it as a duplicate of a row nobody can see.
          dedupeKey: sql`'expired:' || ${schema.taskSuggestions.id}`,
          snoozeUntil: null,
          decidedById: userId ?? null,
          decidedVia: 'dashboard',
          decidedAt: stamp,
          updatedAt: stamp,
        })
        .where(inArray(schema.taskSuggestions.id, open.map(row => row.id)))
    }

    // Rows expired by an earlier pass, before keys retired with the row, get
    // the same treatment so they stop blocking re-reads. Runs in both modes.
    await drizzle
      .update(schema.taskSuggestions)
      .set({ dedupeKey: sql`'expired:' || ${schema.taskSuggestions.id}` })
      .where(and(
        inArray(schema.taskSuggestions.transcriptId, batch),
        eq(schema.taskSuggestions.status, 'expired'),
        notLike(schema.taskSuggestions.dedupeKey, 'expired:%'),
      ))

    // Last, and deliberately: in replace mode a failure above must not leave
    // the transcripts clear with the old rows still pending, which the
    // re-read would then have to reconcile against rows it was told were
    // gone.
    await drizzle
      .update(schema.callTranscripts)
      .set({ suggestedAt: null })
      .where(inArray(schema.callTranscripts.id, batch))
  }

  const cleared = { mode, expired, kept, transcripts: transcriptIds.length }
  if (!readNow) return NextResponse.json(cleared)

  const now = transcriptIds.slice(0, MAX_SWEEP_BATCH)
  const deferred = transcriptIds.length - now.length
  let read: SweepSummary | null = null
  let readError: string | undefined
  try {
    read = await runSuggestionSweep(drizzle, { transcriptIds: now, batch: now.length, secondPass })
  } catch (err) {
    // The marks are cleared whatever happened here, so nothing is lost: the
    // scheduled sweep reads them. Said in the body rather than as a 500,
    // because the rebuild itself did what it was asked.
    readError = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({ ...cleared, read, deferred, ...(readError ? { readError } : {}) })
}
