import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne } from 'drizzle-orm'
import { createNotifications } from '@/lib/notifications'

// ── GET /api/portal/conversations/[id]/messages ────────────────────────────
// Paginated messages for a conversation. Only returns non-internal messages.
// Verifies the user's org is a participant.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: conversationId } = await params

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const database = await db()

  // Verify conversation exists and is external
  const convRows = await database
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)

  if (convRows.length === 0) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const conv = convRows[0]

  if (conv.visibility !== 'external') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the conversation belongs to the user's org
  // Either the conversation's orgId matches, or the user is a participant
  const contactRows = await database
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.orgId, orgId),
        eq(schema.contacts.clerkUserId, userId)
      )
    )
    .limit(1)

  const participantId = contactRows.length > 0 ? contactRows[0].id : userId

  // Check org match or participant membership
  let hasAccess = conv.orgId === orgId

  if (!hasAccess) {
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

    hasAccess = participantCheck.length > 0
  }

  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get messages - only non-internal
  const messages = await database
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.isInternal, false)
      )
    )
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
        isInternal: false,
        authorId: msg.authorId,
        authorType: msg.authorType,
        authorName,
        authorAvatarUrl,
        createdAt: msg.createdAt,
        editedAt: msg.editedAt,
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
    items: enrichedMessages.reverse(),
    page,
    limit,
  })
}

// ── POST /api/portal/conversations/[id]/messages ───────────────────────────
// Send a message from a client. Always isInternal=false.
// Body: { content }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId } = await getRequestAuth(req)

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: conversationId } = await params

    let body: { content?: string }
    try {
      body = await req.json() as { content?: string }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.content?.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const database = await db()

    // Verify conversation exists and is external
    const convRows = await database
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1)

    if (convRows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const conv = convRows[0]

    if (conv.visibility !== 'external') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Find the contact record
    const contactRows = await database
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.orgId, orgId),
          eq(schema.contacts.clerkUserId, userId)
        )
      )
      .limit(1)

    const participantId = contactRows.length > 0 ? contactRows[0].id : userId

    // Verify access (org match or participant)
    let hasAccess = conv.orgId === orgId

    if (!hasAccess) {
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

      hasAccess = participantCheck.length > 0
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const msgId = crypto.randomUUID()

    await database.insert(schema.messages).values({
      id: msgId,
      conversationId,
      requestId: conv.requestId ?? null,
      orgId,
      authorId: participantId,
      authorType: 'contact',
      body: body.content.trim(),
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    })

    // Update conversation updatedAt
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
  } catch (err) {
    console.error('[POST /api/portal/conversations/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
