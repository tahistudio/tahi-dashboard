import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql } from 'drizzle-orm'

// ── GET /api/admin/conversations ────────────────────────────────────────────
// List conversations the current user participates in.
// Includes last message preview and unread count.
// Supports ?type= filter (direct, group, org_channel, request_thread).
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const typeFilter = url.searchParams.get('type')

  const database = await db()

  // Find team member record for the current user
  const teamMemberRows = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  const participantId = teamMemberRows.length > 0 ? teamMemberRows[0].id : userId

  // Get conversations the user participates in
  const conditions = [eq(schema.conversationParticipants.participantId, participantId)]

  const participantConvs = await database
    .select({ conversationId: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(and(...conditions))

  const convIds = participantConvs.map(c => c.conversationId)
  if (convIds.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Get full conversation data
  let allConvs = await database
    .select()
    .from(schema.conversations)
    .orderBy(desc(schema.conversations.updatedAt))

  // Filter to only conversations the user participates in
  allConvs = allConvs.filter(c => convIds.includes(c.id))

  // Apply type filter
  if (typeFilter) {
    allConvs = allConvs.filter(c => c.type === typeFilter)
  }

  // For each conversation, get participants, last message, and unread count
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

      // Get last message
      const lastMessages = await database
        .select({
          id: schema.messages.id,
          body: schema.messages.body,
          createdAt: schema.messages.createdAt,
          authorId: schema.messages.authorId,
          authorType: schema.messages.authorType,
        })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conv.id))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1)

      const lastMessage = lastMessages.length > 0 ? lastMessages[0] : null

      // Calculate unread count
      const currentParticipant = participants.find(p => p.participantId === participantId)
      const lastReadAt = currentParticipant?.lastReadAt
      let unreadCount = 0

      if (lastMessage) {
        if (!lastReadAt) {
          // Never read - count all messages
          const allMsgs = await database
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(eq(schema.messages.conversationId, conv.id))
          unreadCount = allMsgs.length
        } else if (lastMessage.createdAt > lastReadAt) {
          // Count messages after lastReadAt
          const unreadMsgs = await database
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.conversationId, conv.id),
                sql`${schema.messages.createdAt} > ${lastReadAt}`
              )
            )
          unreadCount = unreadMsgs.length
        }
      }

      // Get org name if org-scoped
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

// ── POST /api/admin/conversations ───────────────────────────────────────────
// Create a new conversation.
// Body: { type, name?, orgId?, visibility, participantIds: [{id, type}] }
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    type?: string
    name?: string
    orgId?: string
    requestId?: string
    visibility?: string
    participantIds?: Array<{ id: string; type: string }>
  }

  const { type, name, orgId: convOrgId, requestId, visibility, participantIds } = body

  if (!type || !['direct', 'group', 'org_channel', 'request_thread'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be one of: direct, group, org_channel, request_thread' },
      { status: 400 }
    )
  }

  if (!visibility || !['internal', 'external'].includes(visibility)) {
    return NextResponse.json(
      { error: 'visibility must be one of: internal, external' },
      { status: 400 }
    )
  }

  const database = await db()

  // Resolve the current user's team member ID
  const teamMemberRows = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  const creatorParticipantId = teamMemberRows.length > 0 ? teamMemberRows[0].id : userId

  const convId = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.conversations).values({
    id: convId,
    type,
    name: name ?? null,
    orgId: convOrgId ?? null,
    requestId: requestId ?? null,
    visibility,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Add the creator as an admin participant
  await database.insert(schema.conversationParticipants).values({
    id: crypto.randomUUID(),
    conversationId: convId,
    participantId: creatorParticipantId,
    participantType: 'team_member',
    role: 'admin',
    joinedAt: now,
  })

  // Add other participants
  if (participantIds && participantIds.length > 0) {
    for (const p of participantIds) {
      // Skip if the participant is the creator
      if (p.id === creatorParticipantId) continue

      await database.insert(schema.conversationParticipants).values({
        id: crypto.randomUUID(),
        conversationId: convId,
        participantId: p.id,
        participantType: p.type === 'contact' ? 'contact' : 'team_member',
        role: 'member',
        joinedAt: now,
      })
    }
  }

  return NextResponse.json({ id: convId }, { status: 201 })
}
