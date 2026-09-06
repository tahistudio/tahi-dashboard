/**
 * lib/messages-store.ts
 *
 * The read half of the Messages inbox, shared by the portal and the studio so
 * the two audiences can never drift into two different definitions of "unread"
 * or "the last thing anybody said".
 *
 * ONE INBOX OVER TWO STORES (see lib/messages-inbox.ts for the vocabulary):
 *
 *   channel   messages WHERE conversation_id = the org's org_channel row
 *   request   messages WHERE request_id = a request the reader can open
 *
 * Nothing is copied between them and no message row is written twice. A
 * request thread is READ BY request_id ALONE, with no conversation filter, for
 * one concrete reason: a client message posted from the request detail carries
 * request_id and a NULL conversation_id (app/api/portal/requests/[id]/messages),
 * so a conversation-keyed read would show the studio's half of the
 * conversation and silently drop every question the client asked. That is the
 * same rule app/api/admin/overview/replies-waiting was rewritten onto.
 *
 * WHAT A CLIENT CAN NEVER SEE, enforced here rather than at each call site:
 *   - is_internal messages. Not "hidden": excluded from the rows, from the
 *     last-message preview and from the unread count.
 *   - deleted_at messages, on both sides. A retracted message must not leave
 *     behind a badge that nothing can clear.
 *   - a request outside their org, or outside their brand links when they have
 *     any (the same narrowing app/api/portal/requests applies).
 *   - a Tahi-internal request, at all.
 *
 * EVERY read is batched and sliced. D1 caps a statement at 100 bound
 * parameters and a client's request list is unbounded, so every IN goes
 * through chunkThreadIds (lib/request-thread.ts) exactly as the two thread
 * GETs do.
 */

import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { chunkThreadIds } from '@/lib/request-thread'
import {
  countUnread,
  inboxSnippet,
  inboxThreadHref,
  sortInboxThreads,
  threadKey,
  type InboxPerson,
  type InboxSource,
  type InboxThread,
} from '@/lib/messages-inbox'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Budgets ──────────────────────────────────────────────────────────────────

/**
 * How far back the inbox looks for activity. A thread with nothing in the
 * window still appears when its request is live (see LIVE_STATUSES), so an
 * open piece of work always has somewhere to talk; a delivered request that
 * went quiet six months ago drops off the list rather than padding it.
 */
export const INBOX_WINDOW_DAYS = 120

/** Requests considered per read. The studio's inbox spans every client. */
export const INBOX_REQUEST_CAP = 150

/** Messages returned for one open thread. Older ones are behind a page. */
export const THREAD_PAGE_SIZE = 80

/** A request in one of these still deserves a room even when it is silent. */
const LIVE_STATUSES = new Set(['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold'])

function windowStart(now = new Date()): string {
  return new Date(now.getTime() - INBOX_WINDOW_DAYS * 86_400_000).toISOString()
}

// ── The reader ───────────────────────────────────────────────────────────────

export interface InboxViewer {
  /** The id request_reads is keyed on, and the id the bell knows. */
  clerkUserId: string
  /** contacts.id or teamMembers.id. Null when the person has no domain row. */
  domainId: string | null
  userType: 'team_member' | 'contact'
}

/** Every id this reader's own messages could have been written under. */
function selfIds(viewer: InboxViewer): string[] {
  return [viewer.clerkUserId, viewer.domainId].filter((x): x is string => !!x)
}

/**
 * The id a channel cursor is keyed on: `conversation_participants` stores
 * `teamMembers.id` / `contacts.id`, so that is the first choice.
 *
 * The Clerk id is the fallback rather than a refusal. Somebody with no domain
 * row yet (an invited contact before their first link, a team member added in
 * Clerk before D1) would otherwise have a badge that counts up and can never
 * be cleared, because the read had nothing to write against. A cursor under
 * their Clerk id clears their own badge and is invisible to everybody else;
 * `orgChannelParticipants` still seeds the room by domain id, so this row is
 * an extra rather than a replacement.
 */
function channelCursorId(viewer: InboxViewer): string {
  return viewer.domainId ?? viewer.clerkUserId
}

export interface InboxRequestScope {
  orgIds: readonly string[]
  /** Client only, and only when they have brand links. Null means no narrowing. */
  brandIds: readonly string[] | null
  audience: 'client' | 'studio'
}

// ── Raw message rows ─────────────────────────────────────────────────────────

interface WindowMessage {
  id: string
  requestId: string | null
  conversationId: string | null
  authorId: string
  authorType: string
  isInternal: boolean | null
  createdAt: string | null
  deletedAt: string | null
  body: string
}

/**
 * The body is truncated IN SQL. A thread's worth of composer HTML across every
 * request a studio has open is megabytes of payload for a list that shows one
 * line of it.
 */
const WINDOW_COLUMNS = {
  id: schema.messages.id,
  requestId: schema.messages.requestId,
  conversationId: schema.messages.conversationId,
  authorId: schema.messages.authorId,
  authorType: schema.messages.authorType,
  isInternal: schema.messages.isInternal,
  createdAt: schema.messages.createdAt,
  deletedAt: schema.messages.deletedAt,
  body: sql<string>`substr(${schema.messages.body}, 1, 400)`.as('body_preview'),
}

// ── Names ────────────────────────────────────────────────────────────────────

interface NameBook {
  team: Map<string, { name: string; avatarUrl: string | null }>
  contact: Map<string, string>
}

async function loadNames(database: DrizzleDB, messages: readonly WindowMessage[]): Promise<NameBook> {
  const teamIds = [...new Set(messages.filter(m => m.authorType === 'team_member').map(m => m.authorId))]
  const contactIds = [...new Set(messages.filter(m => m.authorType !== 'team_member').map(m => m.authorId))]

  const team = new Map<string, { name: string; avatarUrl: string | null }>()
  const contact = new Map<string, string>()

  for (const slice of chunkThreadIds(teamIds)) {
    const rows = await database
      .select({ id: schema.teamMembers.id, name: schema.teamMembers.name, avatarUrl: schema.teamMembers.avatarUrl })
      .from(schema.teamMembers)
      .where(inArray(schema.teamMembers.id, slice))
    for (const r of rows) team.set(r.id, { name: r.name, avatarUrl: r.avatarUrl ?? null })
  }
  for (const slice of chunkThreadIds(contactIds)) {
    const rows = await database
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, slice))
    for (const r of rows) contact.set(r.id, r.name)
  }
  return { team, contact }
}

function authorName(book: NameBook, m: { authorId: string; authorType: string }): string | null {
  if (m.authorType === 'team_member') return book.team.get(m.authorId)?.name ?? null
  return book.contact.get(m.authorId) ?? null
}

// ── Voice notes ──────────────────────────────────────────────────────────────

async function loadVoiceNotes(
  database: DrizzleDB,
  messageIds: readonly string[],
): Promise<Map<string, { storageKey: string; durationSeconds: number | null; mimeType: string | null }>> {
  const out = new Map<string, { storageKey: string; durationSeconds: number | null; mimeType: string | null }>()
  for (const slice of chunkThreadIds(messageIds)) {
    const rows = await database
      .select({
        messageId: schema.voiceNotes.messageId,
        storageKey: schema.voiceNotes.storageKey,
        durationSeconds: schema.voiceNotes.durationSeconds,
        mimeType: schema.voiceNotes.mimeType,
      })
      .from(schema.voiceNotes)
      .where(inArray(schema.voiceNotes.messageId, slice))
    for (const r of rows) {
      if (!r.messageId) continue
      out.set(r.messageId, {
        storageKey: r.storageKey,
        durationSeconds: r.durationSeconds ?? null,
        mimeType: r.mimeType ?? null,
      })
    }
  }
  return out
}

// ── The list ─────────────────────────────────────────────────────────────────

export interface InboxListResult {
  threads: InboxThread[]
  /** The org channel ids resolved for this read, keyed by org. */
  channelsByOrg: Map<string, string>
}

/**
 * Build the left pane for one reader.
 *
 * `channelIds` is passed in rather than resolved here so a GET never creates a
 * room: the caller resolves with `create: false` and hands over whatever
 * already exists.
 */
export async function loadInboxThreads(
  database: DrizzleDB,
  input: {
    viewer: InboxViewer
    scope: InboxRequestScope
    /** orgId -> conversations.id, for the orgs that already have a channel. */
    channelsByOrg: Map<string, string>
    /** orgId -> display name. Studio only; the portal shows no client name. */
    orgNames: Map<string, string>
    now?: Date
  },
): Promise<InboxListResult> {
  const { viewer, scope } = input
  const orgIds = [...new Set(scope.orgIds.filter(Boolean))]
  if (orgIds.length === 0) return { threads: [], channelsByOrg: input.channelsByOrg }

  const isClient = scope.audience === 'client'
  const since = windowStart(input.now)
  const mine = selfIds(viewer)

  // ── requests in scope ──────────────────────────────────────────────────────
  const requestConditions = [inArray(schema.requests.orgId, orgIds)]
  if (isClient) {
    // A client never sees a Tahi-internal request, and when they carry brand
    // links they only see their own brands. IN never matches NULL, so a
    // brand-linked contact does not see an unbranded request, which is the
    // same rule the portal request list and the email audience both apply.
    requestConditions.push(eq(schema.requests.isInternal, false))
    if (scope.brandIds !== null) {
      if (scope.brandIds.length === 0) return { threads: [], channelsByOrg: input.channelsByOrg }
      requestConditions.push(inArray(schema.requests.brandId, [...scope.brandIds]))
    }
  }
  const requestRows = await database
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      requestNumber: schema.requests.requestNumber,
      status: schema.requests.status,
      updatedAt: schema.requests.updatedAt,
    })
    .from(schema.requests)
    .where(and(...requestConditions))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(INBOX_REQUEST_CAP)

  // ── the messages behind them ───────────────────────────────────────────────
  const requestIds = requestRows.map(r => r.id)
  const windowMessages: WindowMessage[] = []

  for (const slice of chunkThreadIds(requestIds)) {
    const conditions = [
      inArray(schema.messages.requestId, slice),
      isNull(schema.messages.deletedAt),
      gte(schema.messages.createdAt, since),
    ]
    if (isClient) conditions.push(eq(schema.messages.isInternal, false))
    const rows = await database.select(WINDOW_COLUMNS).from(schema.messages).where(and(...conditions))
    windowMessages.push(...rows)
  }

  const channelIds = [...input.channelsByOrg.values()]
  for (const slice of chunkThreadIds(channelIds)) {
    const conditions = [
      inArray(schema.messages.conversationId, slice),
      isNull(schema.messages.deletedAt),
      gte(schema.messages.createdAt, since),
    ]
    if (isClient) conditions.push(eq(schema.messages.isInternal, false))
    const rows = await database.select(WINDOW_COLUMNS).from(schema.messages).where(and(...conditions))
    windowMessages.push(...rows)
  }

  // ── read cursors, one query per store ──────────────────────────────────────
  const readByRequest = new Map<string, string | null>()
  for (const slice of chunkThreadIds(requestIds)) {
    const rows = await database
      .select({ requestId: schema.requestReads.requestId, lastReadAt: schema.requestReads.lastReadAt })
      .from(schema.requestReads)
      .where(and(
        inArray(schema.requestReads.requestId, slice),
        eq(schema.requestReads.userId, viewer.clerkUserId),
        eq(schema.requestReads.userType, viewer.userType),
      ))
    for (const r of rows) readByRequest.set(r.requestId, r.lastReadAt ?? null)
  }

  const readByChannel = new Map<string, string | null>()
  if (channelIds.length > 0) {
    const cursorId = channelCursorId(viewer)
    for (const slice of chunkThreadIds(channelIds)) {
      const rows = await database
        .select({
          conversationId: schema.conversationParticipants.conversationId,
          lastReadAt: schema.conversationParticipants.lastReadAt,
        })
        .from(schema.conversationParticipants)
        .where(and(
          inArray(schema.conversationParticipants.conversationId, slice),
          eq(schema.conversationParticipants.participantId, cursorId),
        ))
      for (const r of rows) readByChannel.set(r.conversationId, r.lastReadAt ?? null)
    }
  }

  // ── group, then project ────────────────────────────────────────────────────
  const byRequest = new Map<string, WindowMessage[]>()
  const byChannel = new Map<string, WindowMessage[]>()
  for (const m of windowMessages) {
    if (m.requestId) {
      const arr = byRequest.get(m.requestId) ?? []
      arr.push(m)
      byRequest.set(m.requestId, arr)
    } else if (m.conversationId) {
      const arr = byChannel.get(m.conversationId) ?? []
      arr.push(m)
      byChannel.set(m.conversationId, arr)
    }
  }

  const newest = (rows: WindowMessage[] | undefined): WindowMessage | null => {
    if (!rows || rows.length === 0) return null
    return rows.reduce((best, m) => ((m.createdAt ?? '') > (best.createdAt ?? '') ? m : best), rows[0])
  }

  const lastIds: string[] = []
  const threads: InboxThread[] = []

  for (const [orgId, conversationId] of input.channelsByOrg) {
    const rows = byChannel.get(conversationId)
    const last = newest(rows)
    if (last) lastIds.push(last.id)
    threads.push({
      key: threadKey('channel', conversationId),
      source: 'channel',
      id: conversationId,
      title: isClient ? 'Tahi Studio' : (input.orgNames.get(orgId) ?? 'Client'),
      requestNumber: null,
      status: null,
      orgId,
      orgName: isClient ? null : (input.orgNames.get(orgId) ?? null),
      lastMessage: null,
      unreadCount: countUnread(rows ?? [], {
        lastReadAt: readByChannel.get(conversationId) ?? null,
        selfIds: mine,
        excludeInternal: isClient,
      }),
      href: null,
      updatedAt: last?.createdAt ?? '',
    })
  }

  for (const r of requestRows) {
    const rows = byRequest.get(r.id)
    const last = newest(rows)
    // A silent request only earns a room while it is live. A delivered piece
    // of work nobody has mentioned in four months is not a conversation.
    if (!last && !LIVE_STATUSES.has(r.status ?? '')) continue
    if (last) lastIds.push(last.id)
    threads.push({
      key: threadKey('request', r.id),
      source: 'request',
      id: r.id,
      title: r.title,
      requestNumber: typeof r.requestNumber === 'number' ? r.requestNumber : null,
      status: r.status ?? null,
      orgId: r.orgId,
      orgName: isClient ? null : (input.orgNames.get(r.orgId) ?? null),
      lastMessage: null,
      unreadCount: countUnread(rows ?? [], {
        lastReadAt: readByRequest.get(r.id) ?? null,
        selfIds: mine,
        excludeInternal: isClient,
      }),
      href: inboxThreadHref('request', r.id),
      updatedAt: last?.createdAt ?? r.updatedAt ?? '',
    })
  }

  // ── the previews ───────────────────────────────────────────────────────────
  const previewMessages = windowMessages.filter(m => lastIds.includes(m.id))
  const [book, voices] = await Promise.all([
    loadNames(database, previewMessages),
    loadVoiceNotes(database, lastIds),
  ])

  for (const t of threads) {
    const rows = t.source === 'channel' ? byChannel.get(t.id) : byRequest.get(t.id)
    const last = newest(rows)
    if (!last) continue
    const voice = voices.get(last.id)
    t.lastMessage = {
      snippet: voice && !inboxSnippet(last.body) ? 'Voice note' : inboxSnippet(last.body),
      at: last.createdAt ?? '',
      authorName: authorName(book, last),
      authorType: last.authorType,
      isVoice: !!voice,
      isInternal: !!last.isInternal,
    }
  }

  return { threads: sortInboxThreads(threads), channelsByOrg: input.channelsByOrg }
}

// ── One open thread ──────────────────────────────────────────────────────────

export interface ThreadMessage {
  id: string
  authorId: string
  authorType: string
  authorName: string | null
  authorAvatarUrl: string | null
  body: string
  isInternal: boolean
  createdAt: string | null
  editedAt: string | null
  isOwn: boolean
  files: Array<{ id: string; filename: string; storageKey: string; mimeType: string | null; sizeBytes: number | null }>
  voiceNote: { url: string; durationSeconds: number | null } | null
}

/**
 * Every message in one thread, oldest first, with its attachments and its
 * voice note.
 *
 * `orgId` is not decoration: the files join is held to it as well as to the
 * message ids, so a file row that somehow points at another tenant's message
 * cannot be served through this endpoint.
 */
export async function loadThreadMessages(
  database: DrizzleDB,
  input: {
    source: InboxSource
    /** requests.id or conversations.id. */
    id: string
    orgId: string
    viewer: InboxViewer
    audience: 'client' | 'studio'
    limit?: number
  },
): Promise<ThreadMessage[]> {
  const isClient = input.audience === 'client'
  const limit = Math.min(Math.max(1, input.limit ?? THREAD_PAGE_SIZE), 200)

  const conditions = [
    input.source === 'request'
      ? eq(schema.messages.requestId, input.id)
      : eq(schema.messages.conversationId, input.id),
    isNull(schema.messages.deletedAt),
  ]
  if (isClient) conditions.push(eq(schema.messages.isInternal, false))

  // Newest first with a limit, then reversed: a long thread must page from the
  // end the reader is actually looking at.
  const rows = await database
    .select({
      id: schema.messages.id,
      authorId: schema.messages.authorId,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      isInternal: schema.messages.isInternal,
      createdAt: schema.messages.createdAt,
      editedAt: schema.messages.editedAt,
    })
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit)

  const ordered = [...rows].sort((a, b) => {
    const at = a.createdAt ?? ''
    const bt = b.createdAt ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })

  const ids = ordered.map(m => m.id)
  const book = await loadNames(
    database,
    ordered.map(m => ({
      id: m.id,
      requestId: null,
      conversationId: null,
      authorId: m.authorId,
      authorType: m.authorType,
      isInternal: m.isInternal,
      createdAt: m.createdAt,
      deletedAt: null,
      body: '',
    })),
  )
  const voices = await loadVoiceNotes(database, ids)

  const filesByMessage = new Map<string, ThreadMessage['files']>()
  for (const slice of chunkThreadIds(ids)) {
    const fileRows = await database
      .select({
        id: schema.files.id,
        messageId: schema.files.messageId,
        filename: schema.files.filename,
        storageKey: schema.files.storageKey,
        mimeType: schema.files.mimeType,
        sizeBytes: schema.files.sizeBytes,
      })
      .from(schema.files)
      .where(and(
        inArray(schema.files.messageId, slice),
        eq(schema.files.orgId, input.orgId),
      ))
    for (const f of fileRows) {
      if (!f.messageId) continue
      const arr = filesByMessage.get(f.messageId) ?? []
      arr.push({
        id: f.id,
        filename: f.filename,
        storageKey: f.storageKey,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      })
      filesByMessage.set(f.messageId, arr)
    }
  }

  const mine = new Set(selfIds(input.viewer))

  return ordered.map(m => {
    const voice = voices.get(m.id)
    return {
      id: m.id,
      authorId: m.authorId,
      authorType: m.authorType,
      authorName: authorName(book, m),
      authorAvatarUrl: m.authorType === 'team_member' ? (book.team.get(m.authorId)?.avatarUrl ?? null) : null,
      body: m.body,
      isInternal: !!m.isInternal,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      isOwn: mine.has(m.authorId),
      files: filesByMessage.get(m.id) ?? [],
      voiceNote: voice
        ? {
            url: `/api/uploads/serve?key=${encodeURIComponent(voice.storageKey)}`,
            durationSeconds: voice.durationSeconds,
          }
        : null,
    }
  })
}

// ── The people in the head ───────────────────────────────────────────────────

export type ThreadPerson = InboxPerson

// ── Read cursors ─────────────────────────────────────────────────────────────

/**
 * Stamp the reader's cursor on a thread, in whichever store owns it.
 *
 * Never a GET side effect. The design draws a single "New" line at the first
 * previously-unread message, and a GET that moved the cursor would erase the
 * line the same paint that drew it.
 */
export async function markThreadRead(
  database: DrizzleDB,
  input: { source: InboxSource; id: string; viewer: InboxViewer },
): Promise<string> {
  const now = new Date().toISOString()

  if (input.source === 'request') {
    const [existing] = await database
      .select({ id: schema.requestReads.id })
      .from(schema.requestReads)
      .where(and(
        eq(schema.requestReads.requestId, input.id),
        eq(schema.requestReads.userId, input.viewer.clerkUserId),
        eq(schema.requestReads.userType, input.viewer.userType),
      ))
      .limit(1)
    if (existing) {
      await database
        .update(schema.requestReads)
        .set({ lastReadAt: now })
        .where(eq(schema.requestReads.id, existing.id))
    } else {
      await database.insert(schema.requestReads).values({
        id: crypto.randomUUID(),
        requestId: input.id,
        userId: input.viewer.clerkUserId,
        userType: input.viewer.userType,
        lastReadAt: now,
      })
    }
    return now
  }

  const cursorId = channelCursorId(input.viewer)
  const [participant] = await database
    .select({ id: schema.conversationParticipants.id })
    .from(schema.conversationParticipants)
    .where(and(
      eq(schema.conversationParticipants.conversationId, input.id),
      eq(schema.conversationParticipants.participantId, cursorId),
    ))
    .limit(1)
  if (participant) {
    await database
      .update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(eq(schema.conversationParticipants.id, participant.id))
  } else {
    await database.insert(schema.conversationParticipants).values({
      id: crypto.randomUUID(),
      conversationId: input.id,
      participantId: cursorId,
      participantType: input.viewer.userType,
      role: 'member',
      joinedAt: now,
      lastReadAt: now,
    })
  }
  return now
}

/** The cursor as it stands, so the page can draw its "New" line before it moves. */
export async function readThreadCursor(
  database: DrizzleDB,
  input: { source: InboxSource; id: string; viewer: InboxViewer },
): Promise<string | null> {
  if (input.source === 'request') {
    const [row] = await database
      .select({ lastReadAt: schema.requestReads.lastReadAt })
      .from(schema.requestReads)
      .where(and(
        eq(schema.requestReads.requestId, input.id),
        eq(schema.requestReads.userId, input.viewer.clerkUserId),
        eq(schema.requestReads.userType, input.viewer.userType),
      ))
      .limit(1)
    return row?.lastReadAt ?? null
  }
  const [row] = await database
    .select({ lastReadAt: schema.conversationParticipants.lastReadAt })
    .from(schema.conversationParticipants)
    .where(and(
      eq(schema.conversationParticipants.conversationId, input.id),
      eq(schema.conversationParticipants.participantId, channelCursorId(input.viewer)),
    ))
    .limit(1)
  return row?.lastReadAt ?? null
}

// ── Attachments ──────────────────────────────────────────────────────────────

/**
 * Tie already-uploaded files to the message that was just written.
 *
 * The rows exist (POST /api/uploads/confirm created them); this only stamps
 * message_id. Scoped to the owning org, and on a request thread to the request
 * as well, so nobody can smuggle another client's file id, or another
 * request's file, under their own message.
 *
 * ONLY AN UNCLAIMED FILE CAN BE CLAIMED. Without the message_id IS NULL clause
 * a caller could name a file already hanging off somebody else's message in
 * the same org and re-parent it onto their own, silently stripping the
 * attachment from the original. Same tenant, but still data loss, and
 * triggerable from the composer.
 */
export async function attachFilesToMessage(
  database: DrizzleDB,
  input: { messageId: string; fileIds: readonly string[]; orgId: string; requestId?: string | null },
): Promise<number> {
  const ids = [...new Set(input.fileIds.filter(Boolean))]
  if (ids.length === 0) return 0
  let stamped = 0
  for (const slice of chunkThreadIds(ids)) {
    const conditions = [
      inArray(schema.files.id, slice),
      eq(schema.files.orgId, input.orgId),
      isNull(schema.files.messageId),
    ]
    if (input.requestId) conditions.push(eq(schema.files.requestId, input.requestId))
    await database.update(schema.files).set({ messageId: input.messageId }).where(and(...conditions))
    stamped += slice.length
  }
  return stamped
}

// ── Small shared reads ───────────────────────────────────────────────────────

/** Display names for a set of orgs, in one sliced read. */
export async function loadOrgNames(
  database: DrizzleDB,
  orgIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(orgIds.filter(Boolean))]
  for (const slice of chunkThreadIds(ids)) {
    const rows = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .where(inArray(schema.organisations.id, slice))
    for (const r of rows) out.set(r.id, r.name)
  }
  return out
}

/** Existing org channels for a set of orgs. Never creates one. */
export async function loadOrgChannels(
  database: DrizzleDB,
  orgIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(orgIds.filter(Boolean))]
  for (const slice of chunkThreadIds(ids)) {
    const rows = await database
      .select({
        id: schema.conversations.id,
        orgId: schema.conversations.orgId,
        createdAt: schema.conversations.createdAt,
      })
      .from(schema.conversations)
      .where(and(
        inArray(schema.conversations.orgId, slice),
        eq(schema.conversations.type, 'org_channel'),
      ))
      .orderBy(asc(schema.conversations.createdAt))
    for (const r of rows) {
      if (!r.orgId) continue
      // Oldest wins, and the ORDER BY above means the first row seen is it.
      if (!out.has(r.orgId)) out.set(r.orgId, r.id)
    }
  }
  return out
}

/**
 * The client's brand narrowing, or null when they have none.
 *
 * Held to the caller's org as well as their login: one person can be a contact
 * at two client orgs on the same Clerk account (CLAUDE.md rule 12).
 */
export async function loadClientScope(
  database: DrizzleDB,
  input: { clerkUserId: string; orgId: string },
): Promise<{ contactId: string | null; brandIds: string[] | null }> {
  const [contact] = await database
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(
      eq(schema.contacts.clerkUserId, input.clerkUserId),
      eq(schema.contacts.orgId, input.orgId),
    ))
    .limit(1)
  if (!contact) return { contactId: null, brandIds: null }

  const links = await database
    .select({ brandId: schema.brandContacts.brandId })
    .from(schema.brandContacts)
    .where(eq(schema.brandContacts.contactId, contact.id))
  const brandIds = links.map(l => l.brandId).filter((x): x is string => !!x)
  return { contactId: contact.id, brandIds: brandIds.length > 0 ? brandIds : null }
}

/**
 * Can this client open this request? The same three gates the portal request
 * list applies, asked about one row.
 */
export async function clientCanSeeRequest(
  database: DrizzleDB,
  input: { requestId: string; orgId: string; brandIds: readonly string[] | null },
): Promise<{ id: string; orgId: string; title: string; requestNumber: number | null; status: string | null; assigneeId: string | null; brandId: string | null } | null> {
  const conditions = [
    eq(schema.requests.id, input.requestId),
    eq(schema.requests.orgId, input.orgId),
    eq(schema.requests.isInternal, false),
  ]
  if (input.brandIds !== null) {
    if (input.brandIds.length === 0) return null
    conditions.push(inArray(schema.requests.brandId, [...input.brandIds]))
  }
  const [row] = await database
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      requestNumber: schema.requests.requestNumber,
      status: schema.requests.status,
      assigneeId: schema.requests.assigneeId,
      brandId: schema.requests.brandId,
    })
    .from(schema.requests)
    .where(and(...conditions))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    requestNumber: typeof row.requestNumber === 'number' ? row.requestNumber : null,
  }
}

/** Every request in scope that is not archived. Used only by the studio switcher. */
export async function loadStudioOrgIds(
  database: DrizzleDB,
  orgIds: readonly string[] | 'all',
): Promise<string[]> {
  if (orgIds !== 'all') return [...new Set(orgIds.filter(Boolean))]
  const rows = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(ne(schema.organisations.status, 'archived'))
  return rows.map(r => r.id).filter((x): x is string => !!x)
}
