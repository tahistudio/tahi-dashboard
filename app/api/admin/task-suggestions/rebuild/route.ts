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
 *   3. `suggested_at` is cleared, last. On a transcript read here that
 *      happens just before its read, which stamps it again, so a read that
 *      never finishes leaves the call unread rather than marked read; on one
 *      deferred, it is what hands the call to the scheduled sweep.
 *
 * `replace` is the escape hatch and the only thing that still expires
 * anything: every pending or snoozed row from a transcript goes to 'expired'
 * (the caller recorded as the decider, snooze alarms cleared, dedupe keys
 * retired with the rows) before that transcript is read again, so the
 * re-read starts from nothing. EXPIRED, not deleted and not rejected: the row
 * is the record of what an old read proposed, and a rejected row would be a
 * lie about a human having looked at it. Meant for a change to what the
 * suggester knows how to propose, where the old rows are wrong in kind rather
 * than merely incomplete. Decided rows are untouched in this mode too. It is
 * read by one rule wherever it is written (`saysYes`): true, 1, or "1",
 * "true" or "yes" in any case, in the body or as `?replace=`.
 *
 * THE RE-READ HAPPENS NOW, by default (`readNow`, on unless false), inside
 * the sweep's time budget (lib/task-suggester.ts SWEEP_BUDGET_MS; a caller
 * that waits minutes is a caller that hangs up, and a Worker whose caller
 * has gone can be cancelled mid-write). lib/task-suggester.ts
 * `runSuggestionSweep` reads the transcripts oldest first, at most
 * MAX_SWEEP_BATCH of them, whatever their age or mark, and asks this route
 * to prepare each one (steps 1 to 3, or the expiry) only when the budget has
 * admitted it, so a transcript it never reaches is left exactly as it was
 * found. Each call is read twice unless the body says `secondPass: false`;
 * at production speeds that is about one call inside the budget.
 *
 * What the read did not reach is DEFERRED to the scheduled sweep: prepared
 * and cleared, so the sweep's next runs read it. Only a transcript the sweep
 * will actually find is deferred. The sweep looks back thirty days and
 * drains about one call a run, so a transcript is left for it only when it
 * is at least DEFER_MARGIN_DAYS inside that window (`sweepWillReach`); an
 * older one is left untouched, still marked as read, and reported under
 * `skipped` as 'too_old_to_defer', to be named again. With `readNow: false`
 * nothing is read here and the same rule decides what is deferred.
 *
 * Also skipped, untouched and reported: a named id that is not a transcript
 * ('not_found'), and a transcript with no linked call ('unlinked'), which
 * the sweep never reads, so clearing its mark would only make it look unread
 * forever.
 *
 * Returns `{ mode, transcripts, kept, expired, read, deferred, skipped }`:
 * `transcripts` read now or deferred, `kept` the undecided rows left in place
 * on them, `expired` the rows `replace` retired, `read` the sweep's summary
 * (null when nothing was read here), `deferred` the transcripts left for the
 * sweep, and `skipped` the ones left alone, each with its reason. A read that
 * throws is reported as `readError` beside the rest rather than as a 500,
 * because the rebuild still did what it could.
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
import { and, eq, inArray, isNotNull, notLike, sql } from 'drizzle-orm'
import { MAX_SWEEP_BATCH, runSuggestionSweep, sweepWillReach, type SweepSummary } from '@/lib/task-suggester'

/**
 * Ids per IN clause. D1 caps bound parameters at 100 per statement, and the
 * expiry binds six values of its own beside the ids, so the chunk leaves
 * room for them rather than sitting at the cap.
 */
const ID_CHUNK = 80

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

/** The words that mean yes to `replace`. The query form exists for a person with curl. */
const YES = new Set(['1', 'true', 'yes'])

/** One rule for the switch that expires things, whether it came in the body or the query. */
function saysYes(value: unknown): boolean {
  if (value === true || value === 1) return true
  return typeof value === 'string' && YES.has(value.trim().toLowerCase())
}

/** Plain string order, the way SQLite compares the ISO text in received_at. */
function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

type SkipReason = 'not_found' | 'unlinked' | 'too_old_to_defer'

interface Candidate {
  id: string
  callId: string | null
  receivedAt: string
}

export async function POST(req: NextRequest) {
  // The budget counts from here, so the lookups before the read are paid for
  // out of the same budget as the read.
  const startedAt = Date.now()
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as RebuildBody

  const named = Array.isArray(body.transcriptIds)
    ? body.transcriptIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const all = body.all === true
  const replace = saysYes(body.replace) || saysYes(new URL(req.url).searchParams.get('replace'))
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
  // read, not every row: a recent unread one is already the sweep's to read,
  // an old one can be named, and counting either would inflate the number
  // the operator reads.
  const skipped: Array<{ transcriptId: string; reason: SkipReason }> = []
  const columns = {
    id: schema.callTranscripts.id,
    callId: schema.callTranscripts.callId,
    receivedAt: schema.callTranscripts.receivedAt,
  }
  const found: Candidate[] = []
  if (all) {
    found.push(...await drizzle
      .select(columns)
      .from(schema.callTranscripts)
      .where(isNotNull(schema.callTranscripts.suggestedAt)))
  } else {
    const ids = Array.from(new Set(named))
    for (const batch of chunk(ids)) {
      found.push(...await drizzle
        .select(columns)
        .from(schema.callTranscripts)
        .where(inArray(schema.callTranscripts.id, batch)))
    }
    const known = new Set(found.map(row => row.id))
    for (const id of ids) if (!known.has(id)) skipped.push({ transcriptId: id, reason: 'not_found' })
  }

  // Oldest first, here rather than in SQL, so the order the read and the
  // deferral follow is one rule for named and `all` alike: the calls closest
  // to falling out of the sweep's window are the ones read inline.
  const candidates: Candidate[] = []
  for (const row of found) {
    if (row.callId) candidates.push(row)
    else skipped.push({ transcriptId: row.id, reason: 'unlinked' })
  }
  candidates.sort((a, b) => byCodeUnit(a.receivedAt, b.receivedAt) || byCodeUnit(a.id, b.id))

  if (candidates.length === 0) {
    return NextResponse.json({ mode, transcripts: 0, kept: 0, expired: 0, read: null, deferred: 0, skipped })
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let expired = 0
  let kept = 0

  // Steps 1 to 3 of the header (or the expiry, with `replace`) for these
  // transcripts. Called for one transcript at a time by the sweep just
  // before it reads it, and once more at the end for everything deferred.
  const prepare = async (ids: readonly string[]): Promise<void> => {
    for (const batch of chunk(ids)) {
      // Counted with a read before any write rather than off a D1 `changes`
      // result, so the number the operator sees is the number of rows this
      // call actually moved (or left alone) rather than whatever the driver
      // reports.
      const open = await drizzle
        .select({ id: schema.taskSuggestions.id })
        .from(schema.taskSuggestions)
        .where(and(
          inArray(schema.taskSuggestions.transcriptId, batch),
          inArray(schema.taskSuggestions.status, ['pending', 'snoozed']),
        ))

      if (!replace) {
        kept += open.length
      } else {
        expired += open.length
        // In chunks of their own: eighty transcripts can hold far more than
        // eighty open rows, and one IN clause over all of them would break
        // the bound parameter cap.
        for (const rows of chunk(open.map(row => row.id))) {
          await drizzle
            .update(schema.taskSuggestions)
            .set({
              status: 'expired',
              // The key retires with the row: a re-read that proposes the same
              // item again must be able to insert it, and the unique index
              // would otherwise count it as a duplicate of a row nobody can see.
              dedupeKey: sql`'expired:' || ${schema.taskSuggestions.id}`,
              snoozeUntil: null,
              decidedById: userId ?? null,
              decidedVia: 'dashboard',
              decidedAt: stamp,
              updatedAt: stamp,
            })
            .where(inArray(schema.taskSuggestions.id, rows))
        }
      }

      // Rows expired by an earlier pass, before keys retired with the row,
      // get the same treatment so they stop blocking re-reads. Both modes.
      await drizzle
        .update(schema.taskSuggestions)
        .set({ dedupeKey: sql`'expired:' || ${schema.taskSuggestions.id}` })
        .where(and(
          inArray(schema.taskSuggestions.transcriptId, batch),
          eq(schema.taskSuggestions.status, 'expired'),
          notLike(schema.taskSuggestions.dedupeKey, 'expired:%'),
        ))

      // Last, and deliberately: in replace mode a failure above must not
      // leave the transcripts clear with the old rows still pending, which
      // the re-read would then have to reconcile against rows it was told
      // were gone.
      await drizzle
        .update(schema.callTranscripts)
        .set({ suggestedAt: null })
        .where(inArray(schema.callTranscripts.id, batch))
    }
  }

  // Everything the read did not take on goes to the sweep if the sweep will
  // find it, and is otherwise left alone and said so.
  const defer = async (rest: readonly Candidate[]): Promise<number> => {
    const at = new Date()
    const queue: string[] = []
    for (const transcript of rest) {
      if (sweepWillReach(transcript.receivedAt, at)) queue.push(transcript.id)
      else skipped.push({ transcriptId: transcript.id, reason: 'too_old_to_defer' })
    }
    await prepare(queue)
    return queue.length
  }

  const respond = (read: SweepSummary | null, deferred: number, readError?: string) => NextResponse.json({
    mode,
    transcripts: candidates.length - skipped.filter(s => s.reason === 'too_old_to_defer').length,
    kept,
    expired,
    read,
    deferred,
    skipped,
    ...(readError ? { readError } : {}),
  })

  if (!readNow) return respond(null, await defer(candidates))

  const inline = candidates.slice(0, MAX_SWEEP_BATCH)
  const prepared = new Set<string>()
  let read: SweepSummary | null = null
  let readError: string | undefined
  try {
    read = await runSuggestionSweep(drizzle, {
      transcriptIds: inline.map(t => t.id),
      batch: inline.length,
      secondPass,
      startedAt,
      beforeRead: async (transcriptId) => {
        await prepare([transcriptId])
        prepared.add(transcriptId)
      },
    })
  } catch (err) {
    // Whatever was prepared stays prepared, and whatever was not is deferred
    // below like anything else the read did not reach: the scheduled sweep
    // picks both up. Said in the body rather than as a 500, because the
    // rebuild itself did what it could.
    readError = err instanceof Error ? err.message : String(err)
  }

  // What the read took on: everything it did not defer, when it finished;
  // only what it had prepared, when it threw. A transcript the gate skipped
  // was looked at and stamped, so it is not deferred.
  const sweepDeferred = new Set(read?.deferredIds ?? [])
  const taken = read
    ? new Set(inline.filter(t => !sweepDeferred.has(t.id)).map(t => t.id))
    : prepared
  const deferred = await defer(candidates.filter(t => !taken.has(t.id)))

  return respond(read, deferred, readError)
}
