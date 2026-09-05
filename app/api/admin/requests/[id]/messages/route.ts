import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc, inArray, isNull } from 'drizzle-orm'
import { notifyMentionedPerson, notifyOrgContacts, notifyTeamMember } from '@/lib/notifications'
import { messageSummary, threadReplyEmailPlan, toPlainText, truncate } from '@/lib/notification-email'
import { parseMentions } from '@/lib/parse-mentions'
import { requireAccessToOrg } from '@/lib/require-access'
import { chunkThreadIds, pickThreadConversationId } from '@/lib/request-thread'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/requests/[id]/messages ────────────────────────────────────
// Returns all messages for a request (admin sees internal + external).
// Access-scoped to the owning request's org: the thread is the whole
// conversation with a client, internal notes included, so a team member
// scoped elsewhere must not be able to read it by guessing an id.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [owner] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!owner) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, owner.orgId)
  if (denied) return denied

  const msgs = await drizzle
    .select({
      id: schema.messages.id,
      authorId: schema.messages.authorId,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      isInternal: schema.messages.isInternal,
      editedAt: schema.messages.editedAt,
      createdAt: schema.messages.createdAt,
      // Join author name from team_members if authorType = team_member
      teamMemberName: schema.teamMembers.name,
      teamMemberAvatar: schema.teamMembers.avatarUrl,
    })
    .from(schema.messages)
    .leftJoin(
      schema.teamMembers,
      and(
        eq(schema.messages.authorId, schema.teamMembers.id),
        eq(schema.messages.authorType, 'team_member')
      )
    )
    // A deleted message is deleted for the studio too. Without this filter a
    // soft-deleted row kept rendering in the thread, so "delete" only ever
    // meant "stamp a column".
    .where(and(
      eq(schema.messages.requestId, id),
      isNull(schema.messages.deletedAt),
    ))
    .orderBy(asc(schema.messages.createdAt))

  // Attached files (files.message_id in the message ids we just loaded),
  // bucketed per message_id.
  //
  // Sliced, because a thread is unbounded and D1 caps a statement at 100 bound
  // parameters: one IN over every message in the thread threw at roughly the
  // 99th and took the whole thread payload with it.
  const msgIds = msgs.map(m => m.id)
  type MessageFileRow = {
    id: string
    messageId: string | null
    filename: string
    mimeType: string | null
    sizeBytes: number | null
    storageKey: string
  }
  const fileRows: MessageFileRow[] = []
  for (const idSlice of chunkThreadIds(msgIds)) {
    const rows = await drizzle
      .select({
        id: schema.files.id,
        messageId: schema.files.messageId,
        filename: schema.files.filename,
        mimeType: schema.files.mimeType,
        sizeBytes: schema.files.sizeBytes,
        storageKey: schema.files.storageKey,
      })
      .from(schema.files)
      .where(inArray(schema.files.messageId, idSlice))
    fileRows.push(...rows)
  }
  const filesByMessage = new Map<string, MessageFileRow[]>()
  for (const f of fileRows) {
    if (!f.messageId) continue
    const arr = filesByMessage.get(f.messageId) ?? []
    arr.push(f)
    filesByMessage.set(f.messageId, arr)
  }
  const items = msgs.map(m => ({ ...m, files: filesByMessage.get(m.id) ?? [] }))

  // The request's thread conversation, so the detail page can REUSE it instead
  // of minting a fresh one on the first message after every page load. Null
  // when the request has never had one; the page creates it once, then reads
  // it back from here on the next load.
  const convRows = await drizzle
    .select({
      id: schema.conversations.id,
      type: schema.conversations.type,
      visibility: schema.conversations.visibility,
      createdAt: schema.conversations.createdAt,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.requestId, id))
  const conversationId = pickThreadConversationId(convRows)

  return NextResponse.json({ items, conversationId, page: 1, limit: items.length })
}

// ── POST /api/admin/requests/[id]/messages ───────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    let body: {
      body?: string
      isInternal?: boolean
      conversationId?: string
      /** R2-uploaded file ids that should be tied to this message.
       *  These rows already exist (created by /api/uploads/confirm);
       *  we just stamp their message_id so they appear inline. */
      attachmentFileIds?: string[]
    }
    try {
      body = await req.json() as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const hasBody = !!body.body?.trim()
    const hasAttachments = (body.attachmentFileIds?.length ?? 0) > 0
    if (!hasBody && !hasAttachments) {
      return NextResponse.json({ error: 'Message body or at least one attachment is required' }, { status: 400 })
    }

    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    // Find the request to get orgId for message. The same read carries what
    // the client-facing notification and email need: the title, the per-org
    // number for the subject prefix, and whether this request is Tahi-internal
    // (a non-internal message on an internal request must still never reach
    // the client, who cannot even see the row).
    const [request] = await drizzle
      .select({
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        requestNumber: schema.requests.requestNumber,
        isInternal: schema.requests.isInternal,
        assigneeId: schema.requests.assigneeId,
        // The portal request list is brand scoped, so the fan-out below is too:
        // a contact linked to another brand cannot open this row.
        brandId: schema.requests.brandId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1)

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    // The lookup above is also the authorisation: posting here emails the
    // client's contacts, so a caller outside this request's org is refused
    // before anything is written.
    const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
    if (denied) return denied

    // Look up team member ID by Clerk user ID. The name signs the email: a
    // client should hear from a person, not from "the team".
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId ?? ''))
      .limit(1)

    const msgId = crypto.randomUUID()
    await drizzle.insert(schema.messages).values({
      id: msgId,
      requestId: id,
      conversationId: body.conversationId ?? null,
      orgId: request.orgId,
      authorId: member?.id ?? userId ?? 'unknown',
      authorType: 'team_member',
      body: (body.body ?? '').trim(),
      isInternal: body.isInternal ?? false,
    })

    // Link any pre-uploaded files to this message. The files were
    // already inserted by /api/uploads/confirm with requestId set;
    // we stamp message_id so the GET join groups them under this row.
    // Scoped to files in the same orgId so a client can't smuggle
    // someone else's file id into their own message.
    if (hasAttachments && body.attachmentFileIds) {
      const ids = body.attachmentFileIds.filter(Boolean)
      if (ids.length > 0) {
        await drizzle
          .update(schema.files)
          .set({ messageId: msgId })
          .where(and(
            inArray(schema.files.id, ids),
            eq(schema.files.orgId, request.orgId),
          ))
      }
    }

    // Update request updatedAt
    const msgNow = new Date().toISOString()
    await drizzle
      .update(schema.requests)
      .set({ updatedAt: msgNow })
      .where(eq(schema.requests.id, id))

    // The composer posts rich text; a bell body and an email quote are both
    // plain text, so strip once here rather than shipping tag soup into either.
    const plainBody = toPlainText(body.body ?? '')

    // An internal note, or any note on a Tahi-internal request, is studio-only.
    // The @mention fan-out below is held to the same two gates as the client
    // fan-out further down: without that, mentioning a client contact in an
    // internal note pinged them with its body and a deep link to a row the
    // portal will not show them.
    const clientVisible = !body.isInternal && !request.isInternal

    // Process @mentions and create mention rows + notifications
    const mentionedPeople = parseMentions((body.body ?? '').trim())
    if (mentionedPeople.length > 0) {
      const mentionRows = mentionedPeople.map(m => ({
        id: crypto.randomUUID(),
        entityType: 'message' as const,
        entityId: msgId,
        mentionedId: m.id,
        mentionedType: m.type,
        mentionedById: member?.id ?? userId ?? 'unknown',
        createdAt: msgNow,
      }))
      try {
        await drizzle.insert(schema.mentions).values(mentionRows)
      } catch {
        // Mention insert failures should not block message sending
      }

      const authorId = member?.id ?? userId ?? 'unknown'
      for (const m of mentionedPeople) {
        await notifyMentionedPerson(drizzle, {
          mentionedId: m.id,
          senderTeamMemberId: authorId,
          title: 'You were mentioned in a request message',
          // Plain text, same as every other body on this route. Slicing the raw
          // composer HTML put half a tag in the bell.
          body: messageSummary(body.body ?? ''),
          entityType: 'request',
          entityId: id,
          // parseMentions cannot tell a contact from a team member, so the gate
          // has to live where the id is resolved.
          allowContacts: clientVisible,
        })
      }
    }

    // Notify client contacts about the new message, and email them.
    //
    // Two gates, both load bearing. An internal note is a studio aside and
    // never leaves the building. A Tahi-internal REQUEST is invisible to the
    // portal, so even a normal message on it must not surface: the bell entry
    // would carry an internal title and deep-link to a 404.
    //
    // Only ever quotes the message that was just posted, which this branch has
    // already established is not internal.
    if (clientVisible) {
      const fromName = member?.name?.trim() || 'The Tahi team'
      await notifyOrgContacts(
        drizzle,
        request.orgId,
        {
          type: 'new_message',
          title: 'New message on your request',
          body: messageSummary(body.body ?? ''),
          entityType: 'request',
          entityId: id,
          email: threadReplyEmailPlan({
            audience: 'client',
            requestId: id,
            requestTitle: request.title,
            requestNumber: request.requestNumber,
            fromName,
            message: truncate(plainBody, 900),
          }),
        },
        // Email is permanent, searchable and forwardable, and its subject
        // carries the request title, so the audience is held to exactly the
        // contacts the portal would let open this request.
        { brandId: request.brandId ?? null },
      )
    }

    // Notify request assignee about the new message (if sender is not the assignee)
    if (request.assigneeId && request.assigneeId !== (member?.id ?? userId)) {
      await notifyTeamMember(drizzle, request.assigneeId, {
        type: 'new_message',
        title: `New message on "${request.title}"`,
        body: messageSummary(body.body ?? ''),
        entityType: 'request',
        entityId: id,
      })
    }

    return NextResponse.json({ id: msgId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/requests/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
