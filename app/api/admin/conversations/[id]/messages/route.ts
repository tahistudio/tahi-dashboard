import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

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

  // Resolve team member ID
  const teamMemberRows = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  const participantId = teamMemberRows.length > 0 ? teamMemberRows[0].id : userId

  // Verify the user is a participant
  const participantCheck = await database
    .select({ id: schema.conversationParticipants.id })
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.participantId, participantId)
      )
    )
    .limit(1)

  if (participantCheck.length === 0) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  // Get messages
  const messages = await database
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit)
    .offset(offset)

  // Enrich with sender names
  const enrichedMessages = await Promise.all(
    messages.map(async msg => {
      let authorName = 'Unknown'
      let authorAvatarUrl: string | null = null

      if (msg.authorType === 'team_member') {
        const tm = await database
          .select({ name: schema.teamMembers.name, avatarUrl: schema.teamMembers.avatarUrl })
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.id, msg.authorId))
          .limit(1)
        if (tm.length > 0) {
          authorName = tm[0].name
          authorAvatarUrl = tm[0].avatarUrl
        }
      } else {
        const ct = await database
          .select({ name: schema.contacts.name })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, msg.authorId))
          .limit(1)
        if (ct.length > 0) {
          authorName = ct[0].name
        }
      }

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
      }
    })
  )

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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: conversationId } = await params

  const body = await req.json() as {
    content?: string
    isInternal?: boolean
  }

  if (!body.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const database = await db()

  // Resolve team member ID
  const teamMemberRows = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  const participantId = teamMemberRows.length > 0 ? teamMemberRows[0].id : userId

  // Verify the user is a participant
  const participantCheck = await database
    .select({ id: schema.conversationParticipants.id })
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.participantId, participantId)
      )
    )
    .limit(1)

  if (participantCheck.length === 0) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 })
  }

  // Get the conversation to find its orgId
  const convRows = await database
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)

  if (convRows.length === 0) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const conv = convRows[0]
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
    body: body.content.trim(),
    isInternal: body.isInternal ?? false,
    createdAt: now,
    updatedAt: now,
  })

  // Update conversation's updatedAt
  await database
    .update(schema.conversations)
    .set({ updatedAt: now })
    .where(eq(schema.conversations.id, conversationId))

  // Update sender's lastReadAt
  await database
    .update(schema.conversationParticipants)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.participantId, participantId)
      )
    )

  return NextResponse.json({ id: msgId }, { status: 201 })
}

// ── PATCH /api/admin/conversations/[id]/messages ────────────────────────────
// Soft-delete a message: set deletedAt timestamp.
// Body: { messageId, deleted: true }
export async function PATCH(
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

  const body = await req.json() as {
    messageId?: string
    deleted?: boolean
  }

  if (!body.messageId) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  }

  const database = await db()

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
}
