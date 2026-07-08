import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, inArray } from 'drizzle-orm'
import { createNotifications } from '@/lib/notifications'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

// ── GET /api/portal/conversations/[id]/messages ────────────────────────────
// Paginated messages for a conversation. Only returns non-internal messages.
// Verifies the user's org is a participant.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getPortalAuth(req)

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

  // Batch-load voice notes so playback resolves the real R2 file.
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
      isInternal: false,
      authorId: msg.authorId,
      authorType: msg.authorType,
      authorName,
      authorAvatarUrl,
      createdAt: msg.createdAt,
      editedAt: msg.editedAt,
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
    const { orgId, userId, impersonating } = await getPortalAuth(req)

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (impersonating) {
      return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
    }

    const { id: conversationId } = await params

    let body: {
      content?: string
      voiceNote?: { storageKey?: string; durationSeconds?: number; mimeType?: string }
    }
    try {
      body = await req.json() as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.content?.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    // Client HTML rendered to admins via dangerouslySetInnerHTML: sanitise here.
    const safeContent = sanitizeRichText(body.content)
    if (!safeContent.trim()) {
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
      body: safeContent,
      isInternal: false,
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

    // Notify other participants (team members) about the client message
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

    const recipients = otherParticipants.map((p) => ({
      userId: p.participantId,
      userType: p.participantType as 'team_member' | 'contact',
    }))

    if (recipients.length > 0) {
      const convName = conv.name ?? 'conversation'
      await createNotifications(database, recipients, {
        type: 'new_message',
        title: `New message in ${convName}`,
        body: safeContent.slice(0, 200),
        entityType: 'message',
        entityId: conversationId,
      })
    }

    return NextResponse.json({ id: msgId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/conversations/[id]/messages]', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
