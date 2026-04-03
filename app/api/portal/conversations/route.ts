import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql } from 'drizzle-orm'

// ── GET /api/portal/conversations ──────────────────────────────────────────
// List conversations for the current client org where visibility = 'external'.
// Includes unread count, last message preview, participant info.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Find the contact record for this user
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

  // Get conversation IDs this user participates in
  const participantConvs = await database
    .select({ conversationId: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.participantId, participantId))

  const convIds = participantConvs.map(c => c.conversationId)

  // Also include org-scoped conversations for this org where visibility=external
  const orgConvs = await database
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.orgId, orgId),
        eq(schema.conversations.visibility, 'external')
      )
    )

  // Merge unique IDs
  const allIds = new Set([...convIds, ...orgConvs.map(c => c.id)])

  if (allIds.size === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Get full conversation data - only external visibility
  let allConvs = await database
    .select()
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))

  allConvs = allConvs.filter(c => allIds.has(c.id) && c.visibility === 'external')

  const conversationsWithMeta = await Promise.all(
    allConvs.map(async conv => {
      // Get participants
      const participants = await database
        .select()
        .from(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, conv.id))

      // Get participant names
      const participantNames: string[] = []
      for (const p of participants) {
        if (p.participantType === 'team_member') {
          const tm = await database
            .select({ name: schema.teamMembers.name })
            .from(schema.teamMembers)
            .where(eq(schema.teamMembers.id, p.participantId))
            .limit(1)
          if (tm.length > 0) participantNames.push(tm[0].name)
        } else {
          const ct = await database
            .select({ name: schema.contacts.name })
            .from(schema.contacts)
            .where(eq(schema.contacts.id, p.participantId))
            .limit(1)
          if (ct.length > 0) participantNames.push(ct[0].name)
        }
      }

      // Get last message (external only)
      const lastMessages = await database
        .select({
          id: schema.messages.id,
          body: schema.messages.body,
          createdAt: schema.messages.createdAt,
          authorType: schema.messages.authorType,
        })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, conv.id),
            eq(schema.messages.isInternal, false)
          )
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(1)

      const lastMessage = lastMessages.length > 0 ? lastMessages[0] : null

      // Calculate unread count (external messages only)
      const currentParticipant = participants.find(p => p.participantId === participantId)
      const lastReadAt = currentParticipant?.lastReadAt
      let unreadCount = 0

      if (lastMessage) {
        if (!lastReadAt) {
          const allMsgs = await database
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.conversationId, conv.id),
                eq(schema.messages.isInternal, false)
              )
            )
          unreadCount = allMsgs.length
        } else if (lastMessage.createdAt > lastReadAt) {
          const unreadMsgs = await database
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.conversationId, conv.id),
                eq(schema.messages.isInternal, false),
                sql`${schema.messages.createdAt} > ${lastReadAt}`
              )
            )
          unreadCount = unreadMsgs.length
        }
      }

      // Get org name
      let orgName: string | null = null
      if (conv.orgId) {
        const orgs = await database
          .select({ name: schema.organisations.name })
          .from(schema.organisations)
          .where(eq(schema.organisations.id, conv.orgId))
          .limit(1)
        if (orgs.length > 0) orgName = orgs[0].name
      }

      return {
        ...conv,
        orgName,
        participantNames,
        participantCount: participants.length,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body.substring(0, 120),
              createdAt: lastMessage.createdAt,
              authorType: lastMessage.authorType,
            }
          : null,
        unreadCount,
      }
    })
  )

  return NextResponse.json({ conversations: conversationsWithMeta })
}

// ── POST /api/portal/conversations ─────────────────────────────────────────
// Client creates a new conversation. Always external visibility.
// Body: { type: 'direct', content? }
export async function POST(req: NextRequest) {
  try {
    const { orgId, userId } = await getRequestAuth(req)

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: { type?: string; content?: string }
    try {
      body = await req.json() as { type?: string; content?: string }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const type = body.type ?? 'direct'
    if (!['direct', 'group'].includes(type)) {
      return NextResponse.json(
        { error: 'Clients can only create direct or group conversations' },
        { status: 400 }
      )
    }

    const database = await db()

    // Find the contact record for this user (primary contact of the org)
    const contactRows = await database
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.orgId, orgId),
          eq(schema.contacts.clerkUserId, userId)
        )
      )
      .limit(1)

    // If no matching contact by clerkUserId, try primary contact
    let contactId: string
    if (contactRows.length > 0) {
      contactId = contactRows[0].id
    } else {
      const primaryRows = await database
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.orgId, orgId),
            eq(schema.contacts.isPrimary, true)
          )
        )
        .limit(1)

      if (primaryRows.length === 0) {
        return NextResponse.json(
          { error: 'No contact found for this organisation' },
          { status: 400 }
        )
      }
      contactId = primaryRows[0].id
    }

    const convId = crypto.randomUUID()
    const now = new Date().toISOString()

    // Get org name for conversation name
    const orgRows = await database
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)

    const orgName = orgRows.length > 0 ? orgRows[0].name : 'Client'

    await database.insert(schema.conversations).values({
      id: convId,
      type,
      name: `${orgName} - New conversation`,
      orgId,
      requestId: null,
      visibility: 'external',
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })

    // Add the contact as a participant
    await database.insert(schema.conversationParticipants).values({
      id: crypto.randomUUID(),
      conversationId: convId,
      participantId: contactId,
      participantType: 'contact',
      role: 'member',
      joinedAt: now,
    })

    // If there is initial content, send as the first message
    if (body.content?.trim()) {
      const msgId = crypto.randomUUID()
      await database.insert(schema.messages).values({
        id: msgId,
        conversationId: convId,
        requestId: null,
        orgId,
        authorId: contactId,
        authorType: 'contact',
        body: body.content.trim(),
        isInternal: false,
        createdAt: now,
        updatedAt: now,
      })
    }

    return NextResponse.json({ id: convId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/conversations]', err)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
