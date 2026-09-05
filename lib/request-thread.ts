/**
 * lib/request-thread.ts
 *
 * Pure helpers for the request thread, the one conversation a client actually
 * has with the studio. No DB, no fetch, no React: everything here is a
 * function of its arguments so the rules can be tested once and reused by the
 * detail page and by the routes that feed it.
 *
 * Three rules live here.
 *
 * 1. A request has exactly ONE thread conversation. The detail page used to
 *    hold conversationId in state that started at null and was never hydrated,
 *    so the first message after every page load minted a fresh
 *    request_thread row. pickThreadConversationId is the deterministic choice
 *    over whatever rows a request already carries, so the page reuses one
 *    instead of adding to the pile.
 *
 * 2. A request_thread conversation is ALWAYS external. The old create call
 *    copied the visibility of whichever message happened to open the thread,
 *    which made a client's own conversation internal at random. Per-message
 *    isInternal is what hides a studio note from a client; the conversation
 *    itself is the shared room.
 *
 * 3. "Seen by" is about the CLIENT. A studio read receipt is not news to the
 *    studio, so formatClientSeenBy filters to contact receipts before it says
 *    anything at all.
 *
 * 4. A thread is unbounded, so anything keyed off its message ids has to be
 *    sliced before it reaches D1. chunkThreadIds is that slice.
 */

import { formatDistance } from 'date-fns'

export const REQUEST_THREAD_CONVERSATION_TYPE = 'request_thread'
export const REQUEST_THREAD_CONVERSATION_VISIBILITY = 'external'

// ── D1 parameter budget ──────────────────────────────────────────────────────

/**
 * How many ids go into one IN clause.
 *
 * D1 caps a statement at 100 bound parameters, and a request thread grows
 * without limit: a retainer request collects messages for as long as the
 * client keeps talking. Both thread GETs join the files stamped onto each
 * message, which binds one parameter per visible message, so an unsliced IN
 * threw somewhere around the 99th message and took the WHOLE detail payload
 * with it (title, status, thread, participants), not just the attachments.
 *
 * 90 leaves room for the other predicates in the same statement. It matches
 * the ID_CHUNK that lib/delivery-aggregate.ts, lib/blockers-server.ts,
 * lib/request-participants.ts and app/api/admin/requests/bulk/route.ts each
 * hold privately; one shared constant would be better and is left to a pass
 * that owns all of them.
 */
export const THREAD_ID_CHUNK = 90

/**
 * Slice ids into groups small enough to bind in one D1 statement.
 *
 * Empty in, empty out, so a caller can loop over the result without a
 * separate length guard around the query.
 */
export function chunkThreadIds(ids: readonly string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += THREAD_ID_CHUNK) {
    out.push(ids.slice(i, i + THREAD_ID_CHUNK))
  }
  return out
}

// ── One conversation per request ─────────────────────────────────────────────

export interface ThreadConversationRow {
  id: string
  type: string | null
  visibility: string | null
  createdAt: string | null
}

/**
 * The canonical thread conversation for a request, or null when it has none.
 *
 * Ordering, most significant first:
 *   external before internal - a request thread that a client can be a party
 *     to beats a legacy row that was stamped internal by accident,
 *   oldest first - the row every earlier message already points at,
 *   id - so a request with two same-second rows always resolves the same way.
 *
 * Rows minted before the hydration fix therefore collapse on their own: every
 * new message attaches to the row this function picks, and the strays are left
 * inert for a reviewed tidy rather than deleted underneath live data.
 *
 * Two notes ride on that ordering, both for the tidy rather than for live
 * code:
 *
 *  - the fallback to a non-external row exists only because the old create
 *    call could mint one. Running
 *      UPDATE conversations SET visibility = 'external'
 *        WHERE type = 'request_thread' AND visibility <> 'external';
 *    once (idempotent, touches no message rows) makes that branch unreachable
 *    in live data and restores rule 2 as an invariant rather than a promise
 *    about rows created from here on.
 *
 *  - when the tidy collapses duplicates it should repoint
 *    messages.conversation_id at the row it keeps rather than only deleting
 *    the strays, and prefer the row the existing messages already reference
 *    over the visibility rank, so one request's history cannot end up split
 *    across two ids the day the conversations surface ships.
 */
export function pickThreadConversationId(rows: ThreadConversationRow[]): string | null {
  const candidates = rows.filter(r => !!r.id && r.type === REQUEST_THREAD_CONVERSATION_TYPE)
  if (candidates.length === 0) return null

  const rank = (r: ThreadConversationRow) =>
    r.visibility === REQUEST_THREAD_CONVERSATION_VISIBILITY ? 0 : 1

  const sorted = [...candidates].sort((a, b) => {
    const byVisibility = rank(a) - rank(b)
    if (byVisibility !== 0) return byVisibility
    // A missing timestamp sorts last: a row we can date is a safer anchor.
    const at = a.createdAt ?? ''
    const bt = b.createdAt ?? ''
    if (at !== bt) {
      if (!at) return 1
      if (!bt) return -1
      return at < bt ? -1 : 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return sorted[0].id
}

/** One seed participant, in the shape POST /api/admin/conversations reads. */
export interface ThreadParticipantSeed {
  id: string
  type: 'team_member' | 'contact'
}

export interface RequestThreadConversationPayload {
  type: typeof REQUEST_THREAD_CONVERSATION_TYPE
  name: string
  orgId: string
  requestId: string
  visibility: typeof REQUEST_THREAD_CONVERSATION_VISIBILITY
  /**
   * Always empty today: the thread reads by requestId, so nothing depends on
   * conversation_participants yet. Typed as the route's own shape rather than
   * as bare ids because this helper is now the documented body for that POST,
   * and the route builds each row from { id, type }.
   */
  participantIds: ThreadParticipantSeed[]
}

/** The create body for a request's thread conversation. Visibility is fixed. */
export function buildRequestThreadConversationPayload(input: {
  requestId: string
  orgId: string
  title?: string | null
}): RequestThreadConversationPayload {
  const name = input.title?.trim()
  return {
    type: REQUEST_THREAD_CONVERSATION_TYPE,
    name: name && name.length > 0 ? name : 'Request thread',
    orgId: input.orgId,
    requestId: input.requestId,
    visibility: REQUEST_THREAD_CONVERSATION_VISIBILITY,
    participantIds: [],
  }
}

// ── Read receipts ────────────────────────────────────────────────────────────

export interface ThreadReadReceipt {
  /** Clerk user id, the same id space request_reads.user_id stores. */
  userId: string
  /** 'team_member' | 'contact' */
  userType: string
  /** Resolved display name, null when the row has no matching person. */
  name: string | null
  lastReadAt: string
}

/**
 * The most recent CLIENT receipt, as the ISO string it was stored with, or
 * null when nobody at the client has opened the request.
 *
 * formatClientSeenBy phrases the same fact relatively, and a relative phrase
 * goes stale on a tab somebody leaves open all afternoon. This is the absolute
 * timestamp behind that sentence: the header hangs it off a title so the exact
 * time is always recoverable, and the page uses it to decide whether the
 * sentence needs a clock at all.
 */
export function latestClientReadAt(reads: ThreadReadReceipt[]): string | null {
  let bestTime = Number.NEGATIVE_INFINITY
  let best: string | null = null
  for (const r of reads) {
    if (r.userType !== 'contact') continue
    const t = new Date(r.lastReadAt).getTime()
    if (Number.isNaN(t)) continue
    if (t > bestTime) {
      bestTime = t
      best = r.lastReadAt
    }
  }
  return best
}

/**
 * "Seen by Sam about 2 hours ago", or null when no client has opened it.
 *
 * `now` is injected rather than read from the clock so the sentence is a pure
 * function of its inputs and the test does not need fake timers.
 */
export function formatClientSeenBy(reads: ThreadReadReceipt[], now: Date): string | null {
  const latestByUser = new Map<string, { name: string | null; at: Date }>()

  for (const r of reads) {
    if (r.userType !== 'contact') continue
    const at = new Date(r.lastReadAt)
    if (Number.isNaN(at.getTime())) continue
    const existing = latestByUser.get(r.userId)
    if (!existing || existing.at < at) {
      latestByUser.set(r.userId, { name: r.name, at })
    }
  }

  const people = [...latestByUser.values()].sort((a, b) => b.at.getTime() - a.at.getTime())
  if (people.length === 0) return null

  const names = people.map(p => p.name?.trim() || 'the client')
  const ago = formatDistance(people[0].at, now, { addSuffix: true })

  if (names.length === 1) return `Seen by ${names[0]} ${ago}`
  if (names.length === 2) return `Seen by ${names[0]} and ${names[1]} ${ago}`
  const others = names.length - 2
  return `Seen by ${names[0]}, ${names[1]} and ${others} ${others === 1 ? 'other' : 'others'} ${ago}`
}
