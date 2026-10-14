/**
 * lib/request-handoff.ts
 *
 * THE ONE PLACE a request hand-off is described.
 *
 * Liam: "requests are mainly for us, but occasionally I'll need a client to
 * help with a request (a person on the org), or I'll be blocked by them for
 * something, so I should be able to assign clients to requests."
 *
 * The shape that answers that: a request keeps its Tahi owner, and at any
 * moment it can ALSO be handed to one named contact at the client, with a
 * reason and an optional date. That person sees it in their own "Waiting on
 * you" with exactly one action; their org admin sees the org-wide list; the
 * studio sees a chip and a rail view. It hands itself back the moment the
 * person acts, and a nudge goes out if they do not.
 *
 * WHY THE COPY LIVES HERE AND NOWHERE ELSE. One reason slug drives four
 * separate surfaces: the sentence the client reads, the single verb they are
 * given, the participant role written beside them, and the short word on the
 * studio's chip. Typed at each call site those four drift within a week, and
 * the drift is invisible (nobody at the studio ever reads the client's copy).
 * So every string derived from a reason is a lookup in this file, and the UI
 * slices call these functions rather than writing their own.
 *
 * WHY THERE IS NO BLOCKER ROW. A hand-off looks like a blocker and is
 * deliberately not one: work_blockers rows have to be closed by hand, and the
 * whole point here is that the request un-blocks itself when the client acts.
 * The "Blocked by" card renders a synthetic line off the pointer columns
 * instead, so there is nothing stale to clean up.
 */

import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import {
  buildWaitingOn,
  daysWaiting,
  isHandoffReason,
  type WaitingOnPayload,
} from '@/lib/request-handoff-copy'

// The reason vocabulary, the payload shapes, the day math and the chip and
// banner copy are pure (no server import) and live in request-handoff-copy.ts
// so a 'use client' component can read them without pulling drizzle-orm and
// the D1 schema into the browser bundle. Re-exported in full here so every
// existing importer of this file keeps the same names at the same path.
export * from '@/lib/request-handoff-copy'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ─── The pointer, server side ────────────────────────────────────────────────

/**
 * Every pointer column, set back to null.
 *
 * Exported and shared by all four clear paths (studio hand-back, client
 * hand-back, and the three auto hand-backs) so a column added to the pointer
 * later cannot be left behind by one of them.
 */
export const HANDOFF_CLEARED_COLUMNS = {
  waitingOnContactId: null,
  waitingReason: null,
  waitingSince: null,
  waitingDueAt: null,
  waitingNote: null,
  waitingNudgedAt: null,
} as const

/** The audit action written when a request is handed to a client. */
export const AUDIT_HANDED_OFF = 'request.handed_off'
/** The audit action written on every hand-back, whoever or whatever caused it. */
export const AUDIT_HANDED_BACK = 'request.handed_back'
/** The hand-back reason stamped when the client acted rather than pressed it. */
export const HANDBACK_REASON_CLIENT_ACTED = 'client_acted'

// ─── The payload builder, over a page of requests ────────────────────────────

/** How many request ids go into one IN clause. Well under D1's bound cap. */
const ID_BATCH_SIZE = 80

/**
 * Resolve the pointer for a page of requests, contact name included.
 *
 * A SEPARATE query rather than six more columns on each list route's select,
 * for one reason: this whole feature ships behind migration 0104, and a bare
 * select of a column that does not exist yet 500s the entire requests list.
 * Here a missing column costs the chip and nothing else. Returns an empty map
 * (never throws) on any failure.
 */
export async function loadWaitingOn(
  drizzle: Drizzle,
  requestIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, WaitingOnPayload>> {
  const byRequest = new Map<string, WaitingOnPayload>()
  if (requestIds.length === 0) return byRequest

  try {
    const batches: string[][] = []
    for (let i = 0; i < requestIds.length; i += ID_BATCH_SIZE) {
      batches.push(requestIds.slice(i, i + ID_BATCH_SIZE))
    }
    const results = await Promise.all(batches.map(ids => drizzle
      .select({
        id: schema.requests.id,
        waitingOnContactId: schema.requests.waitingOnContactId,
        waitingReason: schema.requests.waitingReason,
        waitingSince: schema.requests.waitingSince,
        waitingDueAt: schema.requests.waitingDueAt,
        waitingNote: schema.requests.waitingNote,
        contactName: schema.contacts.name,
      })
      .from(schema.requests)
      .leftJoin(schema.contacts, eq(schema.requests.waitingOnContactId, schema.contacts.id))
      .where(and(
        inArray(schema.requests.id, ids),
        isNotNull(schema.requests.waitingOnContactId),
      ))))

    for (const row of results.flat()) {
      const built = buildWaitingOn(row, row.contactName, now)
      if (built) byRequest.set(row.id, built)
    }
  } catch {
    // Migration 0104 has not landed, or the join failed. "Nothing is waiting
    // on anyone" is the correct degradation: it hides a chip, it does not
    // invent one or break the list it rides on.
    return byRequest
  }
  return byRequest
}

/** The pointer for exactly one request. Same tolerance as the batch form. */
export async function loadWaitingOnOne(
  drizzle: Drizzle,
  requestId: string,
  now: Date = new Date(),
): Promise<WaitingOnPayload | null> {
  const map = await loadWaitingOn(drizzle, [requestId], now)
  return map.get(requestId) ?? null
}

// ─── The auto hand-back ──────────────────────────────────────────────────────

/** Which client action handed the request back. Stamped into the audit row. */
export type HandbackTrigger = 'review_approved' | 'file_uploaded' | 'thread_message'

const TRIGGER_SENTENCE: Record<HandbackTrigger, string> = {
  review_approved: 'approved it',
  file_uploaded: 'uploaded a file to it',
  thread_message: 'replied on the thread',
}

export interface HandBackOnClientActionInput {
  requestId: string
  /** The contacts.id of whoever just acted. Null for an unresolvable caller. */
  contactId: string | null
  /** Their display name, for the studio's notification. */
  contactName: string | null
  trigger: HandbackTrigger
}

/**
 * The request hands itself back.
 *
 * Called from the three writes a handed-off client can make: approving in
 * client review, uploading a file to the request, and posting on its thread.
 * Nothing about those routes changes except one awaited call, and this
 * function never throws, so a hand-off that cannot be cleared never costs the
 * client their approval, their file or their message.
 *
 * Only ever fires for the person the request is actually WITH. A colleague at
 * the same client replying on the thread is a normal reply, not somebody
 * else's hand-off being satisfied, and clearing the pointer there would tell
 * the studio the work was unblocked when it is not.
 *
 * "Notified once" is a property of the clear, not of a dedupe table: the
 * second action finds a null pointer and returns false without a word.
 */
export async function handBackOnClientAction(
  drizzle: Drizzle,
  input: HandBackOnClientActionInput,
): Promise<boolean> {
  if (!input.contactId) return false

  try {
    const [request] = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        assigneeId: schema.requests.assigneeId,
        waitingOnContactId: schema.requests.waitingOnContactId,
        waitingReason: schema.requests.waitingReason,
        waitingSince: schema.requests.waitingSince,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, input.requestId))
      .limit(1)

    if (!request?.waitingOnContactId) return false
    if (request.waitingOnContactId !== input.contactId) return false

    await drizzle
      .update(schema.requests)
      .set({ ...HANDOFF_CLEARED_COLUMNS, updatedAt: new Date().toISOString() })
      .where(eq(schema.requests.id, input.requestId))

    const who = input.contactName?.trim() || 'The client'
    const reason = isHandoffReason(request.waitingReason) ? request.waitingReason : 'other'

    await logAudit(drizzle as unknown as DB, {
      action: AUDIT_HANDED_BACK,
      userId: input.contactId,
      userType: 'contact',
      entityType: 'request',
      entityId: input.requestId,
      metadata: {
        reason: HANDBACK_REASON_CLIENT_ACTED,
        trigger: input.trigger,
        waitingReason: reason,
        waitingSince: request.waitingSince ?? null,
        daysWaiting: daysWaiting(request.waitingSince),
      },
    })

    await notifyRequestTeam(
      drizzle,
      { requestId: input.requestId, orgId: request.orgId, assigneeId: request.assigneeId ?? null },
      {
        type: 'request_status_changed',
        title: `Back with us: "${request.title}"`,
        body: `${who} ${TRIGGER_SENTENCE[input.trigger]}, so it is no longer waiting on them.`,
        entityType: 'request',
        entityId: input.requestId,
      },
    )

    return true
  } catch (err) {
    // Never the reason a client's own write fails. A pointer that outlives the
    // action shows as a stale chip the studio can clear by hand, which is far
    // cheaper than a 500 on approve.
    console.warn('[request-handoff] auto hand-back failed:', err)
    return false
  }
}
