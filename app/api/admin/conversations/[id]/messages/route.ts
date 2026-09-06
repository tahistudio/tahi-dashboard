import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, inArray } from 'drizzle-orm'
import { createNotifications, notifyMentionedPerson, resolveParticipants } from '@/lib/notifications'
import { parseMentions } from '@/lib/parse-mentions'
import { requireConversationAccess } from '../../_access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/conversations/[id]/messages ──────────────────────────────
// Paginated messages for a conversation. Joins sender info.
// Auth: verifies current user is a participant.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: conversationId } = await params

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const database = await db()

  // Participation + org scope
  const access = await requireConversationAccess(database as unknown as D1, { userId, orgId }, conversationId)
  if (!access.ok) return access.response
  const { participantId } = access

  // Get messages
  const messages = await database
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit)
    .offset(offset)

  // Batch-load voice notes for these messages so playback has a real
  // R2 URL to point at (the serve route enforces org-scoping on the key).
  const messageIds = messages.map(m => m.id)
  const voiceRows = messageIds.length
    ? await database
        .select()
        .from(schema.voiceNotes)
        .where(inArray(schema.voiceNotes.messageId, messageIds))
    : []
  const voiceByMessage = new Map(voiceRows.map(v => [v.messageId, v]))

  // Batch-load author names by type to avoid a per-message lookup (N+1).
  // The two lookups are independent, so resolve them concurrently.
  const teamMemberAuthorIds = [...new Set(
    messages.filter(m => m.authorType === 'team_member').map(m => m.authorId)
  )]
  const contactAuthorIds = [...new Set(
    messages.filter(m => m.authorType !== 'team_member').map(m => m.authorId)
  )]

  const [tmAuthorRows, contactAuthorRows] = await Promise.all([
    teamMemberAuthorIds.length
      ? database
          .select({ id: schema.teamMembers.id, name: schema.teamMembers.name, avatarUrl: schema.teamMembers.avatarUrl })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.id, teamMemberAuthorIds))
      : Promise.resolve([] as { id: string; name: string; avatarUrl: string | null }[]),
    contactAuthorIds.length
      ? database
          .select({ id: schema.contacts.id, name: schema.contacts.name })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, contactAuthorIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ])

  const tmAuthorById = new Map(tmAuthorRows.map(r => [r.id, r]))
  const contactNameById = new Map(contactAuthorRows.map(r => [r.id, r.name]))

  // Enrich with sender names from the batched maps.
  const enrichedMessages = messages.map(msg => {
    let authorName = 'Unknown'
    let authorAvatarUrl: string | null = null

    if (msg.authorType === 'team_member') {
      const tm = tmAuthorById.get(msg.authorId)
      if (tm) {
        authorName = tm.name
        authorAvatarUrl = tm.avatarUrl
      }
    } else {
      const nm = contactNameById.get(msg.authorId)
      if (nm) authorName = nm
    }

    const vn = voiceByMessage.get(msg.id)

    return {
      id: msg.id,
      body: msg.body,
      isInternal: msg.isInternal,
      authorId: msg.authorId,
      authorType: msg.authorType,
      authorName,
      authorAvatarUrl,
      createdAt: msg.createdAt,
      editedAt: msg.editedAt,
      deletedAt: msg.deletedAt ?? null,
      voiceNote: vn
        ? {
            url: `/api/uploads/serve?key=${encodeURIComponent(vn.storageKey)}`,
            durationSeconds: vn.durationSeconds ?? undefined,
          }
        : null,
    }
  })

  // Update lastReadAt for the current participant
  await database
    .update(schema.conversationParticipants)
    .set({ lastReadAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.participantId, participantId)
      )
    )

  return NextResponse.json({
    items: enrichedMessages.reverse(), // chronological order
    page,
    limit,
  })
}

// ── POST /api/admin/conversations/[id]/messages ─────────────────────────────
// Send a message in a conversation.
// Body: { content, isInternal? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params

    let body: {
      content?: string
      /**
       * Alias for `content`. The worker MCP tool `send_message` has always
       * posted `body`, so every call it made answered 400 "content is
       * required" and no message was ever sent through it. Both names are
       * read now rather than renaming one and breaking the other caller.
       */
      body?: string
      isInternal?: boolean
      voiceNote?: { storageKey?: string; durationSeconds?: number; mimeType?: string }
    }
    try {
      body = await req.json() as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const content = (body.content ?? body.body ?? '').trim()
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const database = await db()

    // Participation + org scope
    const access = await requireConversationAccess(database as unknown as D1, { userId, orgId }, conversationId)
    if (!access.ok) return access.response
    const { participantId, conversation: conv } = access

    const now = new Date().toISOString()
    const msgId = crypto.randomUUID()

    // We need an orgId for the messages table. Use the conversation's orgId,
    // or fall back to looking up any org associated.
    let msgOrgId = conv.orgId
    if (!msgOrgId) {
      // For internal conversations without an org, use a placeholder approach:
      // Find the first org from participants of type 'contact'
      const contactParticipants = await database
        .select({ participantId: schema.conversationParticipants.participantId })
        .from(schema.conversationParticipants)
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, conversationId),
            eq(schema.conversationParticipants.participantType, 'contact')
          )
        )
        .limit(1)

      if (contactParticipants.length > 0) {
        const contact = await database
          .select({ orgId: schema.contacts.orgId })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, contactParticipants[0].participantId))
          .limit(1)
        if (contact.length > 0) msgOrgId = contact[0].orgId
      }
    }

    // If still no orgId, we cannot insert (messages.orgId is NOT NULL).
    // Use the Tahi org as a fallback for internal-only conversations.
    if (!msgOrgId) {
      msgOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? 'tahi-internal'
    }

    await database.insert(schema.messages).values({
      id: msgId,
      conversationId,
      requestId: conv.requestId ?? null,
      orgId: msgOrgId,
      authorId: participantId,
      authorType: 'team_member',
      body: content,
      isInternal: body.isInternal ?? false,
      createdAt: now,
      updatedAt: now,
    })

    // Persist the voice note reference so playback can resolve the R2 file.
    if (body.voiceNote?.storageKey) {
      await database.insert(schema.voiceNotes).values({
        id: crypto.randomUUID(),
        messageId: msgId,
        storageKey: body.voiceNote.storageKey,
        durationSeconds: body.voiceNote.durationSeconds ?? null,
        mimeType: body.voiceNote.mimeType ?? 'audio/webm',
      })
    }

    // Bump the conversation's updatedAt and the sender's lastReadAt. These
    // touch different tables with no data dependency, so run them concurrently.
    await Promise.all([
      database
        .update(schema.conversations)
        .set({ updatedAt: now })
        .where(eq(schema.conversations.id, conversationId)),
      database
        .update(schema.conversationParticipants)
        .set({ lastReadAt: now })
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, conversationId),
            eq(schema.conversationParticipants.participantId, participantId)
          )
        ),
    ])

    // Process @mentions and create mention rows + notifications
    const mentionedPeople = parseMentions(content)
    if (mentionedPeople.length > 0) {
      const mentionRows = mentionedPeople.map(m => ({
        id: crypto.randomUUID(),
        entityType: 'message' as const,
        entityId: msgId,
        mentionedId: m.id,
        mentionedType: m.type,
        mentionedById: participantId,
        createdAt: now,
      }))
      try {
        await database.insert(schema.mentions).values(mentionRows)
      } catch {
        // Mention insert failures should not block message sending
      }

      // Create notifications for mentioned people (skip the sender,
      // resolve mention.id → Clerk user id so the bell can find it).
      for (const m of mentionedPeople) {
        await notifyMentionedPerson(database, {
          mentionedId: m.id,
          senderTeamMemberId: participantId,
          title: 'You were mentioned in a message',
          body: content.slice(0, 200),
          entityType: 'message',
          entityId: conversationId,
        })
      }
    }

    // Notify other participants about the new message
    const otherParticipants = await database
      .select({
        participantId: schema.conversationParticipants.participantId,
        participantType: schema.conversationParticipants.participantType,
      })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          ne(schema.conversationParticipants.participantId, participantId)
        )
      )

    // If internal-only, only notify team members. resolveParticipants maps
    // participant row ids to Clerk user ids (the id the bell queries) and
    // skips unlinked people; the query above already excludes the sender and
    // excludeParticipantId keeps that true if the query ever changes.
    const audience = otherParticipants.filter(
      (p) => !body.isInternal || p.participantType === 'team_member'
    )
    const recipients = await resolveParticipants(database, audience, {
      excludeParticipantId: participantId,
    })

    if (recipients.length > 0) {
      const convName = conv.name ?? 'conversation'
      await createNotifications(database, recipients, {
        type: 'new_message',
        title: `New message in ${convName}`,
        body: content.slice(0, 200),
        entityType: 'message',
        entityId: conversationId,
      })
    }

    return NextResponse.json({ id: msgId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/conversations/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

// ── PATCH /api/admin/conversations/[id]/messages ────────────────────────────
// Soft-delete a message: set deletedAt timestamp.
// Body: { messageId, deleted: true }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params

    let body: { messageId?: string; deleted?: boolean }
    try {
      body = await req.json() as { messageId?: string; deleted?: boolean }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.messageId) {
      return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
    }

    const database = await db()

    // Participation + org scope. Without this any Tahi-org caller could
    // soft-delete a message in a thread they are not part of.
    const access = await requireConversationAccess(database as unknown as D1, { userId, orgId }, conversationId)
    if (!access.ok) return access.response

    // Verify the message belongs to this conversation
    const msgRows = await database
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.id, body.messageId),
          eq(schema.messages.conversationId, conversationId),
        )
      )
      .limit(1)

    if (msgRows.length === 0) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const now = new Date().toISOString()
    await database
      .update(schema.messages)
      .set({
        deletedAt: body.deleted ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.messages.id, body.messageId))

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/admin/conversations/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
