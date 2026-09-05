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
 */

import { formatDistance } from 'date-fns'

export const REQUEST_THREAD_CONVERSATION_TYPE = 'request_thread'
export const REQUEST_THREAD_CONVERSATION_VISIBILITY = 'external'

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

export interface RequestThreadConversationPayload {
  type: typeof REQUEST_THREAD_CONVERSATION_TYPE
  name: string
  orgId: string
  requestId: string
  visibility: typeof REQUEST_THREAD_CONVERSATION_VISIBILITY
  participantIds: string[]
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
