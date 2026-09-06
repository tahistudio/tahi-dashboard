/**
 * GET  /api/portal/messages/<source>/<id>   one open thread
 * POST /api/portal/messages/<source>/<id>   the client's reply
 *
 * A thread is addressed by a (source, id) PAIR rather than by one id, because
 * the two stores key on different tables: 'channel' carries a conversations.id
 * and 'request' carries a requests.id. Two path segments, so nothing has to
 * agree about escaping a delimiter inside a URL.
 *
 * On the 'channel' source the id in the path is IGNORED and the room is
 * resolved from the authenticated org instead, which is what makes
 * `channel/<somebody else's id>` unreachable rather than merely unlikely. The
 * page addresses it as `channel/new` before it has a row at all: GET answers
 * with an empty room, and POST resolves-or-creates it, which is the only place
 * a portal read or write mints a conversation.
 *
 * The GET does NOT move the read cursor. The page draws a single "New" line at
 * the first previously-unread message, and a GET that stamped the cursor would
 * erase that line in the same paint that drew it. POST .../read is the explicit
 * move.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'
import { isInboxSource, inboxThreadHref, type InboxSource } from '@/lib/messages-inbox'
import {
  attachFilesToMessage,
  clientCanSeeRequest,
  loadClientScope,
  loadThreadMessages,
  readThreadCursor,
} from '@/lib/messages-store'
import {
  orgChannelParticipants,
  resolveOrgChannel,
  resolveRequestThread,
  syncConversationParticipants,
  threadPeople,
} from '@/lib/org-channel'
import { createNotifications, type NotificationRecipient } from '@/lib/notifications'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import {
  channelMessageEmailPlan,
  messageSummary,
  threadReplyEmailPlan,
  toPlainText,
  truncate,
} from '@/lib/notification-email'
import { gatePortalMessages, serviceOrgFromQuery } from '../../_shared'

type Params = { params: Promise<{ source: string; id: string }> }
type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function badSource(): NextResponse {
  return NextResponse.json({ error: 'Unknown thread' }, { status: 404 })
}

/**
 * Resolve the addressed thread against everything this client is allowed to
 * open. Returns the conversations.id / requests.id the store should read, or a
 * response to hand straight back.
 */
async function resolveThread(
  database: DrizzleDB,
  input: { source: InboxSource; id: string; orgId: string; clerkUserId: string; create: boolean },
): Promise<
  | { ok: false; response: NextResponse }
  | {
      ok: true
      source: InboxSource
      /** Empty string when the channel does not exist yet and create was false. */
      id: string
      title: string
      requestNumber: number | null
      status: string | null
      assigneeId: string | null
      brandId: string | null
    }
> {
  if (input.source === 'channel') {
    // A client's channel is always their OWN org's: the id in the path is
    // never trusted, it is resolved from the authenticated org. That is what
    // makes `channel/<someone else's id>` unreachable rather than merely
    // unlikely.
    const id = await resolveOrgChannel(database, input.orgId, {
      create: input.create,
      createdById: input.clerkUserId,
    })
    if (!id && !input.create) {
      return { ok: true, source: 'channel', id: '', title: 'Tahi Studio', requestNumber: null, status: null, assigneeId: null, brandId: null }
    }
    if (!id) return { ok: false, response: badSource() }
    return { ok: true, source: 'channel', id, title: 'Tahi Studio', requestNumber: null, status: null, assigneeId: null, brandId: null }
  }

  const scope = await loadClientScope(database, { clerkUserId: input.clerkUserId, orgId: input.orgId })
  const request = await clientCanSeeRequest(database, {
    requestId: input.id,
    orgId: input.orgId,
    brandIds: scope.brandIds,
  })
  if (!request) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return {
    ok: true,
    source: 'request',
    id: request.id,
    title: request.title,
    requestNumber: request.requestNumber,
    status: request.status,
    assigneeId: request.assigneeId,
    brandId: request.brandId,
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const { source: rawSource, id: rawId } = await params
  if (!isInboxSource(rawSource)) return badSource()

  const gate = await gatePortalMessages(req, { write: false, serviceOrgId: serviceOrgFromQuery(req) })
  if (!gate.ok) return gate.response
  const { database, orgId, viewer, impersonating } = gate.ctx

  const resolved = await resolveThread(database, {
    source: rawSource,
    id: rawId,
    orgId,
    clerkUserId: viewer.clerkUserId,
    create: false,
  })
  if (!resolved.ok) return resolved.response

  const head = {
    key: `${resolved.source}:${resolved.id}`,
    source: resolved.source,
    id: resolved.id,
    title: resolved.title,
    requestNumber: resolved.requestNumber,
    status: resolved.status,
    orgId,
    orgName: null,
    href: inboxThreadHref(resolved.source, resolved.id),
    canPost: !impersonating,
    canInternal: false,
  }

  // A channel that has no row yet has no messages and no people. Answering
  // with an empty room is the honest shape, and it costs no reads.
  if (resolved.source === 'channel' && !resolved.id) {
    return NextResponse.json({ thread: head, people: [], messages: [], lastReadAt: null })
  }

  const [messages, lastReadAt, people] = await Promise.all([
    loadThreadMessages(database, {
      source: resolved.source,
      id: resolved.id,
      orgId,
      viewer,
      audience: 'client',
    }),
    readThreadCursor(database, { source: resolved.source, id: resolved.id, viewer }),
    resolved.source === 'channel'
      ? threadPeople(database, { source: 'channel', conversationId: resolved.id, orgId })
      : threadPeople(database, { source: 'request', requestId: resolved.id, orgId, assigneeId: resolved.assigneeId, brandId: resolved.brandId }),
  ])

  return NextResponse.json({ thread: head, people, messages, lastReadAt })
}

// ── POST ─────────────────────────────────────────────────────────────────────

interface SendBody {
  body?: string
  attachmentFileIds?: string[]
  voiceNote?: { storageKey?: string; durationSeconds?: number; mimeType?: string }
  /** MCP parity: the service token names the client org it is writing for. */
  orgId?: string
}

export async function POST(req: NextRequest, { params }: Params) {
  const { source: rawSource, id: rawId } = await params
  if (!isInboxSource(rawSource)) return badSource()

  let body: SendBody
  try {
    body = (await req.json()) as SendBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const gate = await gatePortalMessages(req, {
    write: true,
    serviceOrgId: serviceOrgFromQuery(req) ?? body.orgId ?? null,
  })
  if (!gate.ok) return gate.response
  const { database, orgId, viewer, contactName } = gate.ctx

  // Client HTML is rendered back to admins with dangerouslySetInnerHTML, so it
  // is sanitised before it is stored, not before it is shown.
  const safeBody = sanitizeRichText(body.body ?? '')
  const attachmentIds = (body.attachmentFileIds ?? []).filter(Boolean)
  const hasVoice = !!body.voiceNote?.storageKey
  if (!safeBody.trim() && attachmentIds.length === 0 && !hasVoice) {
    return NextResponse.json(
      { error: 'A message, an attachment or a voice note is required' },
      { status: 400 },
    )
  }

  const resolved = await resolveThread(database, {
    source: rawSource,
    id: rawId,
    orgId,
    clerkUserId: viewer.clerkUserId,
    create: true,
  })
  if (!resolved.ok) return resolved.response

  // Both resolved by the gate, which already read the contact row: a message
  // is authored by the contact when they have one, and by their Clerk id when
  // they do not (an invited person who has never been linked).
  const authorId = viewer.domainId ?? viewer.clerkUserId
  const fromName = contactName ?? 'A client'

  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  const orgName = org?.name ?? 'A client'

  const msgId = crypto.randomUUID()
  const now = new Date().toISOString()

  // A request-thread message keeps its request_id (that is what every reader
  // of the thread is keyed on) AND carries the room's conversation_id, so the
  // Messages page and the request detail write identical rows.
  await database.insert(schema.messages).values({
    id: msgId,
    requestId: resolved.source === 'request' ? resolved.id : null,
    conversationId: resolved.source === 'channel' ? resolved.id : await requestRoomId(database, resolved, orgId, viewer.clerkUserId),
    orgId,
    authorId,
    authorType: 'contact',
    body: safeBody,
    // A client cannot write a studio note. Not "should not": there is no field
    // on this route that could ask for one.
    isInternal: false,
    createdAt: now,
    updatedAt: now,
  })

  if (attachmentIds.length > 0) {
    await attachFilesToMessage(database, {
      messageId: msgId,
      fileIds: attachmentIds,
      orgId,
      requestId: resolved.source === 'request' ? resolved.id : null,
    })
  }

  if (body.voiceNote?.storageKey) {
    await database.insert(schema.voiceNotes).values({
      id: crypto.randomUUID(),
      messageId: msgId,
      storageKey: body.voiceNote.storageKey,
      durationSeconds: body.voiceNote.durationSeconds ?? null,
      mimeType: body.voiceNote.mimeType ?? 'audio/webm',
    })
  }

  const plain = truncate(toPlainText(safeBody), 900)
  const summary = hasVoice && !plain ? 'Sent a voice note' : messageSummary(safeBody)

  if (resolved.source === 'request') {
    await database
      .update(schema.requests)
      .set({ updatedAt: now })
      .where(eq(schema.requests.id, resolved.id))

    // The bell and the inbox ride ONE resolved audience, so the two channels
    // cannot disagree about who the studio side of this request is.
    await notifyRequestTeam(
      database,
      { requestId: resolved.id, orgId, assigneeId: resolved.assigneeId ?? null },
      {
        type: 'new_message',
        title: `New client message on "${resolved.title}"`,
        body: summary,
        entityType: 'request',
        entityId: resolved.id,
        email: threadReplyEmailPlan({
          audience: 'studio',
          requestId: resolved.id,
          requestTitle: resolved.title,
          requestNumber: resolved.requestNumber,
          fromName,
          message: plain,
        }),
      },
    )
  } else {
    await database
      .update(schema.conversations)
      .set({ updatedAt: now })
      .where(eq(schema.conversations.id, resolved.id))
    await notifyChannelTeam(database, {
      conversationId: resolved.id,
      orgId,
      excludeId: authorId,
      title: `New message from ${orgName}`,
      summary,
      fromName,
      orgName,
      plain,
    })
  }

  return NextResponse.json({ id: msgId, threadId: resolved.id }, { status: 201 })
}

/**
 * The request's room identity, created lazily on the first message.
 *
 * The messages do not live in it (they are read by request_id), so this is
 * only ever a WRITE-side concern: it exists so the room has a name and a
 * participant list, and so a client reply and an admin reply on the same
 * request carry the same conversation_id.
 */
async function requestRoomId(
  database: DrizzleDB,
  resolved: { source: InboxSource; id: string; title: string },
  orgId: string,
  createdById: string,
): Promise<string | null> {
  if (resolved.source !== 'request') return null
  try {
    return await resolveRequestThread(
      database,
      { requestId: resolved.id, orgId, title: resolved.title },
      { create: true, createdById },
    )
  } catch {
    // The room is decoration; the message is not. A failure here must never
    // cost the client their reply.
    return null
  }
}

/**
 * Tell the studio a client wrote on their standing line, in the bell and in
 * the inbox, off one audience.
 *
 * The audience is the room's own team participants, which lib/org-channel.ts
 * seeds from the same project_manager join `notifyRequestTeam` reads, falling
 * back to the whole studio when nobody is assigned. Never emails the author.
 */
async function notifyChannelTeam(
  database: DrizzleDB,
  input: {
    conversationId: string
    orgId: string
    excludeId: string
    title: string
    summary: string
    fromName: string
    orgName: string
    plain: string
  },
): Promise<void> {
  try {
    const seeds = await orgChannelParticipants(database, input.orgId)
    await syncConversationParticipants(database, input.conversationId, seeds)
    const recipients: NotificationRecipient[] = seeds
      .filter(s => s.participantType === 'team_member' && s.participantId !== input.excludeId)
      .map(s => ({ teamMemberId: s.participantId }))
    if (recipients.length === 0) return
    await createNotifications(database, recipients, {
      type: 'new_message',
      title: input.title,
      body: input.summary,
      entityType: 'message',
      entityId: input.conversationId,
      email: channelMessageEmailPlan({
        audience: 'studio',
        orgName: input.orgName,
        fromName: input.fromName,
        message: input.plain,
      }),
    })
  } catch {
    // A notification failure must not fail the client's send.
  }
}
