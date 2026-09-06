/**
 * GET  /api/admin/messages/<source>/<id>   one open thread, studio side
 * POST /api/admin/messages/<source>/<id>   the studio's reply, or an internal note
 *
 * Same (source, id) pair the portal uses, same store, same reader. The only
 * differences are the ones the audience earns:
 *
 *   - the studio sees internal notes, and can write one (`isInternal: true`).
 *     A client route has no field that could ask for that.
 *   - the thread is resolved through the caller's org scope
 *     (scopedOrgIds + isOrgInScope), not through their own org, so a scoped
 *     team member naming another client's request id is refused before a
 *     single message is read.
 *
 * On the 'channel' source the id IS a conversations.id here, unlike the portal
 * where it is derived from the authenticated org: the studio legitimately
 * addresses many clients' rooms. It is validated by reading the row and
 * scope-checking its org_id, never by trusting the path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'
import { isInboxSource, inboxThreadHref, type InboxSource } from '@/lib/messages-inbox'
import {
  attachFilesToMessage,
  loadThreadMessages,
  readThreadCursor,
} from '@/lib/messages-store'
import {
  ORG_CHANNEL_TYPE,
  orgChannelParticipants,
  resolveOrgChannel,
  resolveRequestThread,
  syncConversationParticipants,
  threadPeople,
} from '@/lib/org-channel'
import { notifyOrgContacts, notifyTeamMember } from '@/lib/notifications'
import {
  channelMessageEmailPlan,
  messageSummary,
  threadReplyEmailPlan,
  toPlainText,
  truncate,
} from '@/lib/notification-email'
import { gateAdminMessages, refuseOutOfScope } from '../../_shared'
import type { OrgScope } from '@/lib/access-scope'

type Params = { params: Promise<{ source: string; id: string }> }
type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface ResolvedThread {
  source: InboxSource
  id: string
  orgId: string
  title: string
  requestNumber: number | null
  status: string | null
  assigneeId: string | null
  brandId: string | null
  /** True when the request itself is Tahi-internal, so nothing on it is ever client-facing. */
  requestIsInternal: boolean
}

function channelThread(id: string, orgId: string): ResolvedThread {
  return {
    source: 'channel',
    id,
    orgId,
    title: 'Studio line',
    requestNumber: null,
    status: null,
    assigneeId: null,
    brandId: null,
    requestIsInternal: false,
  }
}

async function resolveThread(
  database: DrizzleDB,
  scope: OrgScope,
  input: { source: InboxSource; id: string; createdById: string; create: boolean },
): Promise<{ ok: false; response: NextResponse } | { ok: true; thread: ResolvedThread }> {
  if (input.source === 'channel') {
    // An org id in the path is a request to open (or open up) that client's
    // standing line; a conversation id is the room itself. Both land on the
    // same scope check.
    const [conversation] = await database
      .select({
        id: schema.conversations.id,
        orgId: schema.conversations.orgId,
        type: schema.conversations.type,
      })
      .from(schema.conversations)
      .where(and(
        eq(schema.conversations.id, input.id),
        eq(schema.conversations.type, ORG_CHANNEL_TYPE),
      ))
      .limit(1)

    if (conversation?.orgId) {
      const denied = refuseOutOfScope(scope, conversation.orgId)
      if (denied) return { ok: false, response: denied }
      return { ok: true, thread: channelThread(conversation.id, conversation.orgId) }
    }

    const [org] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, input.id))
      .limit(1)
    if (!org) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    const denied = refuseOutOfScope(scope, org.id)
    if (denied) return { ok: false, response: denied }

    const channelId = await resolveOrgChannel(database, org.id, {
      create: input.create,
      createdById: input.createdById,
    })
    // No row, and not asked to make one. An empty room is the honest answer
    // for a client the studio has never messaged.
    return { ok: true, thread: channelThread(channelId ?? '', org.id) }
  }

  const [request] = await database
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      requestNumber: schema.requests.requestNumber,
      status: schema.requests.status,
      assigneeId: schema.requests.assigneeId,
      brandId: schema.requests.brandId,
      isInternal: schema.requests.isInternal,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, input.id))
    .limit(1)
  if (!request) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  const denied = refuseOutOfScope(scope, request.orgId)
  if (denied) return { ok: false, response: denied }

  return {
    ok: true,
    thread: {
      source: 'request',
      id: request.id,
      orgId: request.orgId,
      title: request.title,
      requestNumber: typeof request.requestNumber === 'number' ? request.requestNumber : null,
      status: request.status ?? null,
      assigneeId: request.assigneeId ?? null,
      brandId: request.brandId ?? null,
      requestIsInternal: !!request.isInternal,
    },
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const { source, id } = await params
  if (!isInboxSource(source)) return NextResponse.json({ error: 'Unknown thread' }, { status: 404 })

  const gate = await gateAdminMessages(req)
  if (!gate.ok) return gate.response
  const { database, scope, viewer } = gate.ctx

  const resolved = await resolveThread(database, scope, {
    source, id, createdById: viewer.clerkUserId, create: false,
  })
  if (!resolved.ok) return resolved.response
  const t = resolved.thread

  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, t.orgId))
    .limit(1)

  const head = {
    key: `${t.source}:${t.id}`,
    source: t.source,
    id: t.id,
    title: t.source === 'channel' ? (org?.name ?? 'Studio line') : t.title,
    requestNumber: t.requestNumber,
    status: t.status,
    orgId: t.orgId,
    orgName: org?.name ?? null,
    href: inboxThreadHref(t.source, t.id),
    canPost: true,
    // An internal note is only meaningful where a client could otherwise read
    // the room. On a Tahi-internal request everything is already studio-only.
    canInternal: !t.requestIsInternal,
  }

  if (!t.id) {
    return NextResponse.json({ thread: head, people: [], messages: [], lastReadAt: null })
  }

  const [messages, lastReadAt, people] = await Promise.all([
    loadThreadMessages(database, {
      source: t.source, id: t.id, orgId: t.orgId, viewer, audience: 'studio',
    }),
    readThreadCursor(database, { source: t.source, id: t.id, viewer }),
    t.source === 'channel'
      ? threadPeople(database, { source: 'channel', conversationId: t.id, orgId: t.orgId })
      : threadPeople(database, { source: 'request', requestId: t.id, orgId: t.orgId, assigneeId: t.assigneeId, brandId: t.brandId }),
  ])

  return NextResponse.json({ thread: head, people, messages, lastReadAt })
}

// ── POST ─────────────────────────────────────────────────────────────────────

interface SendBody {
  body?: string
  isInternal?: boolean
  attachmentFileIds?: string[]
  voiceNote?: { storageKey?: string; durationSeconds?: number; mimeType?: string }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { source, id } = await params
  if (!isInboxSource(source)) return NextResponse.json({ error: 'Unknown thread' }, { status: 404 })

  let body: SendBody
  try {
    body = (await req.json()) as SendBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const gate = await gateAdminMessages(req)
  if (!gate.ok) return gate.response
  const { database, scope, viewer } = gate.ctx

  const safeBody = sanitizeRichText(body.body ?? '')
  const attachmentIds = (body.attachmentFileIds ?? []).filter(Boolean)
  const hasVoice = !!body.voiceNote?.storageKey
  if (!safeBody.trim() && attachmentIds.length === 0 && !hasVoice) {
    return NextResponse.json(
      { error: 'A message, an attachment or a voice note is required' },
      { status: 400 },
    )
  }

  const resolved = await resolveThread(database, scope, {
    source, id, createdById: viewer.clerkUserId, create: true,
  })
  if (!resolved.ok) return resolved.response
  const t = resolved.thread
  if (!t.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [member] = await database
    .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, viewer.clerkUserId))
    .limit(1)
  const authorId = member?.id ?? viewer.clerkUserId
  const fromName = member?.name?.trim() || 'The Tahi team'

  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, t.orgId))
    .limit(1)
  const orgName = org?.name ?? 'the client'

  const isInternal = body.isInternal === true
  const msgId = crypto.randomUUID()
  const now = new Date().toISOString()

  let conversationId: string | null = t.id
  if (t.source === 'request') {
    try {
      conversationId = await resolveRequestThread(
        database,
        { requestId: t.id, orgId: t.orgId, title: t.title },
        { create: true, createdById: viewer.clerkUserId },
      )
    } catch {
      // The room identity is decoration; the message is not. Every reader of a
      // request thread keys on request_id, so a null here costs nothing.
      conversationId = null
    }
  }

  await database.insert(schema.messages).values({
    id: msgId,
    requestId: t.source === 'request' ? t.id : null,
    conversationId,
    orgId: t.orgId,
    authorId,
    authorType: 'team_member',
    body: safeBody,
    isInternal,
    createdAt: now,
    updatedAt: now,
  })

  if (attachmentIds.length > 0) {
    await attachFilesToMessage(database, {
      messageId: msgId,
      fileIds: attachmentIds,
      orgId: t.orgId,
      requestId: t.source === 'request' ? t.id : null,
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

  // TWO GATES, BOTH LOAD BEARING, AND THE ONLY THING BETWEEN A STUDIO ASIDE
  // AND A CLIENT'S INBOX. An internal note never leaves the building. A
  // Tahi-internal REQUEST is invisible to the portal, so even an ordinary
  // message on it must not surface: the bell entry would carry an internal
  // title and deep-link to a row the client cannot open.
  const clientVisible = !isInternal && !t.requestIsInternal

  if (t.source === 'request') {
    await database.update(schema.requests).set({ updatedAt: now }).where(eq(schema.requests.id, t.id))

    if (clientVisible) {
      await notifyOrgContacts(
        database,
        t.orgId,
        {
          type: 'new_message',
          title: 'New message on your request',
          body: summary,
          entityType: 'request',
          entityId: t.id,
          email: threadReplyEmailPlan({
            audience: 'client',
            requestId: t.id,
            requestTitle: t.title,
            requestNumber: t.requestNumber,
            fromName,
            message: plain,
          }),
        },
        // Email is permanent, searchable and forwardable, and its subject
        // carries the request title, so the audience is held to exactly the
        // contacts the portal would let open this request.
        { brandId: t.brandId },
      )
    }

    if (t.assigneeId && t.assigneeId !== authorId) {
      await notifyTeamMember(database, t.assigneeId, {
        type: 'new_message',
        title: `New message on "${t.title}"`,
        body: summary,
        entityType: 'request',
        entityId: t.id,
      })
    }
  } else {
    await database.update(schema.conversations).set({ updatedAt: now }).where(eq(schema.conversations.id, t.id))
    try {
      await syncConversationParticipants(
        database,
        t.id,
        await orgChannelParticipants(database, t.orgId),
      )
    } catch {
      // Participants are for the head's people stack, not for access.
    }
    if (clientVisible) {
      // No brand filter: the org channel is org-wide by definition, unlike a
      // request, which belongs to exactly one brand.
      await notifyOrgContacts(database, t.orgId, {
        type: 'new_message',
        title: 'New message from the studio',
        body: summary,
        entityType: 'message',
        entityId: t.id,
        email: channelMessageEmailPlan({
          audience: 'client',
          orgName,
          fromName,
          message: plain,
        }),
      })
    }
  }

  return NextResponse.json({ id: msgId, threadId: t.id }, { status: 201 })
}
