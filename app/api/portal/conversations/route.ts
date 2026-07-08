import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

// ── GET /api/portal/conversations ──────────────────────────────────────────
// List conversations for the current client org where visibility = 'external'.
// Includes unread count, last message preview, participant info.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

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

  // Get conversation IDs this user participates in AND org-scoped conversations
  // for this org. These two lookups are independent of each other (one keys off
  // participantId, the other off orgId), so run them concurrently.
  const [participantConvs, orgConvs] = await Promise.all([
    database
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.participantId, participantId)),
    database
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.orgId, orgId),
          eq(schema.conversations.visibility, 'external')
        )
      ),
  ])

  const convIds = participantConvs.map(c => c.conversationId)

  // Merge unique IDs
  const allIds = new Set([...convIds, ...orgConvs.map(c => c.id)])

  if (allIds.size === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Get full conversation data - only external visibility. Filter in SQL via
  // an IN (...) on the merged id set rather than scanning the whole table.
  const allConvs = await database
    .select()
    .from(schema.conversations)
    .where(
      and(
        inArray(schema.conversations.id, [...allIds]),
        eq(schema.conversations.visibility, 'external')
      )
    )
    .orderBy(desc(schema.conversations.updatedAt))

  if (allConvs.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Batch-load all participants for these conversations in one query, then
  // group by conversation. Avoids a per-conversation participant fetch.
  const convIdList = allConvs.map(c => c.id)
  const allParticipants = await database
    .select()
    .from(schema.conversationParticipants)
    .where(inArray(schema.conversationParticipants.conversationId, convIdList))

  const participantsByConv = new Map<string, typeof allParticipants>()
  for (const p of allParticipants) {
    const arr = participantsByConv.get(p.conversationId)
    if (arr) arr.push(p)
    else participantsByConv.set(p.conversationId, [p])
  }

  // Collect participant + org ids and resolve all names in batched lookups.
  // The three queries are independent, so fire them concurrently.
  const teamMemberIds = [...new Set(
    allParticipants.filter(p => p.participantType === 'team_member').map(p => p.participantId)
  )]
  const contactIds = [...new Set(
    allParticipants.filter(p => p.participantType === 'contact').map(p => p.participantId)
  )]
  const orgIdList = [...new Set(
    allConvs.map(c => c.orgId).filter((x): x is string => !!x)
  )]

  const [tmNameRows, contactNameRows, orgNameRows] = await Promise.all([
    teamMemberIds.length
      ? database
          .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.id, teamMemberIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    contactIds.length
      ? database
          .select({ id: schema.contacts.id, name: schema.contacts.name })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, contactIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    orgIdList.length
      ? database
          .select({ id: schema.organisations.id, name: schema.organisations.name })
          .from(schema.organisations)
          .where(inArray(schema.organisations.id, orgIdList))
      : Promise.resolve([] as { id: string; name: string }[]),
  ])

  const tmNameById = new Map(tmNameRows.map(r => [r.id, r.name]))
  const contactNameById = new Map(contactNameRows.map(r => [r.id, r.name]))
  const orgNameById = new Map(orgNameRows.map(r => [r.id, r.name]))

  const conversationsWithMeta = await Promise.all(
    allConvs.map(async conv => {
      const participants = participantsByConv.get(conv.id) ?? []

      // Resolve participant names from the batched maps (same order, same
      // skip-if-missing behaviour as the prior per-row lookups).
      const participantNames: string[] = []
      for (const p of participants) {
        const nm = p.participantType === 'team_member'
          ? tmNameById.get(p.participantId)
          : contactNameById.get(p.participantId)
        if (nm) participantNames.push(nm)
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

      // Org name resolved from the batched map.
      const orgName = conv.orgId ? (orgNameById.get(conv.orgId) ?? null) : null

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
    const { orgId, userId, impersonating } = await getPortalAuth(req)

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (impersonating) {
      return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
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

    // If there is initial content, send as the first message (sanitise the
    // client HTML; it is rendered to admins via dangerouslySetInnerHTML).
    const safeContent = sanitizeRichText(body.content)
    if (safeContent.trim()) {
      const msgId = crypto.randomUUID()
      await database.insert(schema.messages).values({
        id: msgId,
        conversationId: convId,
        requestId: null,
        orgId,
        authorId: contactId,
        authorType: 'contact',
        body: safeContent,
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
