/**
 * lib/messages-inbox.ts
 *
 * The vocabulary of the Messages inbox, and every rule about it that is a
 * function of its arguments. No DB, no fetch, no React, no 'use client', so
 * the routes, the page and the tests all read the same file.
 *
 * ONE INBOX, TWO STORES, ZERO DUPLICATED ROWS. That is the whole design and
 * everything here follows from it:
 *
 *   - the ORG CHANNEL is a real `conversations` row per client
 *     (type 'org_channel', visibility 'external'). Its messages carry
 *     conversation_id and no request_id.
 *   - a REQUEST THREAD is the message stream that already exists on the
 *     request detail. It is keyed on messages.request_id and is PROJECTED
 *     into the same list shape. Nothing is copied, nothing is re-homed, and
 *     a client message written from the request detail (which sets no
 *     conversation_id) is in the thread exactly like a studio reply.
 *
 * A thread is therefore addressed by a (source, id) pair rather than by one
 * id, because the two ids live in different tables.
 */

// ── Thread identity ──────────────────────────────────────────────────────────

/** Which store a thread lives in. */
export type InboxSource = 'channel' | 'request'

const SOURCES: readonly InboxSource[] = ['channel', 'request']

/** Is this string one of the two sources? Used to validate a route segment. */
export function isInboxSource(value: unknown): value is InboxSource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}

/**
 * The single string that identifies a thread across both stores, for a React
 * key and for the page's selection state. The route uses two path segments
 * instead (/api/portal/messages/<source>/<id>), so nothing has to agree about
 * escaping a delimiter inside a URL.
 */
export function threadKey(source: InboxSource, id: string): string {
  return `${source}:${id}`
}

/** The inverse. Null for anything that is not a key this module minted. */
export function parseThreadKey(key: string): { source: InboxSource; id: string } | null {
  const at = key.indexOf(':')
  if (at < 1) return null
  const source = key.slice(0, at)
  const id = key.slice(at + 1)
  if (!isInboxSource(source) || !id) return null
  return { source, id }
}

// ── The row shape both audiences render ──────────────────────────────────────

export interface InboxPerson {
  id: string
  name: string
  avatarUrl: string | null
  /** Which side of the table they sit on, for the bubble alignment. */
  side: 'team' | 'client'
}

export interface InboxPreview {
  /** Plain text, already truncated. Never composer HTML. */
  snippet: string
  at: string
  authorName: string | null
  authorType: string
  /** True when the last message is a voice note, which has no body to quote. */
  isVoice: boolean
  /** True when the last message is a studio-only note. Never sent to a client. */
  isInternal: boolean
}

export interface InboxThread {
  key: string
  source: InboxSource
  id: string
  /** "Mahana Orchards" for a channel, "Brand palette extension" for a request. */
  title: string
  /** The per-org request number, so the row can read "TR-1049 Brand palette". */
  requestNumber: number | null
  /** requests.status, null on a channel. Drives the status dot. */
  status: string | null
  orgId: string
  /** Null on the portal, where every row belongs to the reader's own client. */
  orgName: string | null
  lastMessage: InboxPreview | null
  unreadCount: number
  /** Where "Open the request" goes, per audience. Null for a channel. */
  href: string | null
  /** Sort key: the last message, falling back to the room's own updatedAt. */
  updatedAt: string
}

// ── Plain text ───────────────────────────────────────────────────────────────

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
]

/**
 * A one line preview of a message body.
 *
 * lib/notification-email.ts has the same pair of helpers, and they stay
 * separate on purpose: that module pulls in @react-email/render and every
 * email template with it, so importing it from a list route (or from anything
 * a client component can reach) would drag the whole email stack along.
 */
export function inboxSnippet(html: string | null | undefined, maxChars = 140): string {
  if (!html) return ''
  let text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, ' ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement)
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxChars) return flat
  const hard = flat.slice(0, maxChars)
  const lastSpace = hard.lastIndexOf(' ')
  const body = lastSpace > maxChars * 0.6 ? hard.slice(0, lastSpace) : hard
  return `${body.trimEnd()}...`
}

// ── Unread ───────────────────────────────────────────────────────────────────

/** The columns unread counting needs, and nothing else. */
export interface CountableMessage {
  authorId: string
  createdAt: string | null
  isInternal?: boolean | null
  deletedAt?: string | null
}

export interface UnreadOptions {
  /**
   * The cursor for this reader on this thread. Null means "never opened",
   * which counts everything VISIBLE AND NOT MINE, not everything: the admin
   * conversations route counted the caller's own messages and inflated every
   * room nobody had opened yet.
   */
  lastReadAt: string | null
  /**
   * Every id this reader writes messages under. Two, because the two stores
   * stamp author_id differently: a request thread carries contacts.id /
   * teamMembers.id, and a Clerk id shows up on rows written before the person
   * had a domain row.
   */
  selfIds: readonly string[]
  /** True for a client. Studio notes are not just unread to them, they do not exist. */
  excludeInternal: boolean
}

/**
 * How many messages in this thread the reader has not seen.
 *
 * Deleted rows never count: a message the studio retracted must not leave a
 * badge behind that nothing can clear.
 */
export function countUnread(
  messages: readonly CountableMessage[],
  opts: UnreadOptions,
): number {
  const self = new Set(opts.selfIds.filter(Boolean))
  let n = 0
  for (const m of messages) {
    if (m.deletedAt) continue
    if (opts.excludeInternal && m.isInternal) continue
    if (self.has(m.authorId)) continue
    if (!m.createdAt) continue
    if (opts.lastReadAt && m.createdAt <= opts.lastReadAt) continue
    n += 1
  }
  return n
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * The order the left pane reads in: the standing studio line first, then every
 * request thread by its last message, newest first. A room nobody has posted
 * in yet still sorts by its own updatedAt rather than dropping to the bottom
 * of a list it was just created at the top of.
 */
export function sortInboxThreads(threads: readonly InboxThread[]): InboxThread[] {
  return [...threads].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'channel' ? -1 : 1
    const at = a.lastMessage?.at ?? a.updatedAt ?? ''
    const bt = b.lastMessage?.at ?? b.updatedAt ?? ''
    if (at !== bt) return at < bt ? 1 : -1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// ── The left pane's lens ─────────────────────────────────────────────────────

export type InboxLens = 'all' | 'unread' | 'requests'

export const INBOX_LENSES: ReadonlyArray<{ key: InboxLens; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'requests', label: 'Requests' },
]

export function isInboxLens(value: unknown): value is InboxLens {
  return value === 'all' || value === 'unread' || value === 'requests'
}

/**
 * Narrow the list by the lens and the search box. Pure, so the same rule can
 * be asserted without mounting the page.
 *
 * Search matches the title, the request number in the form the reader sees it
 * ("TR-1049" and "1049"), and the client name on the studio's own inbox.
 */
export function filterInboxThreads(
  threads: readonly InboxThread[],
  opts: { lens: InboxLens; query: string },
): InboxThread[] {
  const q = opts.query.trim().toLowerCase()
  return threads.filter(t => {
    if (opts.lens === 'unread' && t.unreadCount === 0) return false
    if (opts.lens === 'requests' && t.source !== 'request') return false
    if (!q) return true
    const haystack = [
      t.title,
      t.orgName ?? '',
      t.requestNumber === null ? '' : `TR-${t.requestNumber} ${t.requestNumber}`,
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

/** The number the Unread lens carries. */
export function totalUnread(threads: readonly InboxThread[]): number {
  return threads.reduce((n, t) => n + t.unreadCount, 0)
}

// ── Titles and status ────────────────────────────────────────────────────────

export const REQUEST_STATUS_LABEL: Readonly<Record<string, string>> = {
  submitted: 'Submitted',
  in_review: 'In review',
  in_progress: 'In progress',
  client_review: 'Your review',
  on_hold: 'On hold',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

/** The row title, with the number a client has actually been shown. */
export function inboxRowTitle(thread: Pick<InboxThread, 'source' | 'title' | 'requestNumber'>): string {
  if (thread.source !== 'request' || thread.requestNumber === null) return thread.title
  return `TR-${thread.requestNumber} ${thread.title}`
}

/**
 * Where the row's "Open the request" button goes.
 *
 * Both audiences have a request detail at /requests/<id>, so this is one
 * route; it exists as a function anyway because the channel has no
 * destination at all and the caller must not invent one.
 */
export function inboxThreadHref(source: InboxSource, id: string): string | null {
  return source === 'request' ? `/requests/${id}` : null
}
