import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { isOrgInScope } from '../_scoping/org-scope'
import { resolveOrgChannel } from '@/lib/org-channel'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
  // Optional filters for the overview "Unread messages" card so it can request
  // only unread conversations, capped — instead of over-fetching and filtering
  // client-side. Defaults (no params) preserve the full-list behaviour.
  const onlyUnread = url.searchParams.get('unread') === '1'
  const limitParam = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : null

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

  // INTERNAL-CONVERSATION RULE: participation is the primary gate. A thread
  // with no orgId is Tahi-internal and stays governed by participation alone.
  // A thread that carries an orgId is client data, so it additionally has to
  // clear the member's org scope (a participant row left behind after their
  // scope was narrowed must not keep the client thread readable).
  const scope = await scopedOrgIds({ userId, orgId })
  allConvs = allConvs.filter(c => isOrgInScope(scope, c.orgId, 'allow'))

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

  let output = conversationsWithMeta
  if (onlyUnread) output = output.filter(c => c.unreadCount > 0)
  if (limit != null) output = output.slice(0, limit)

  return NextResponse.json({ conversations: output })
}

/**
 * Normalise whatever a caller sent as `participantIds` into rows this table
 * can hold.
 *
 * Accepts `{ id, type }` and the flat `'team_member:<id>'` / `'contact:<id>'`
 * form, tolerates the legacy `'team:<id>'` prefix, and DROPS anything else.
 * Dropping matters: the old code turned an unrecognised entry into an insert
 * with `participantId: undefined`, which is the failure that left orphan
 * conversations behind. `org:<id>` was never a participant type at all, so it
 * is dropped rather than guessed at.
 */
function normaliseParticipantSeeds(
  raw: ReadonlyArray<{ id?: string; type?: string } | string>,
): Array<{ id: string; type: 'team_member' | 'contact' }> {
  const out: Array<{ id: string; type: 'team_member' | 'contact' }> = []
  const seen = new Set<string>()
  for (const entry of raw) {
    let id: string | undefined
    let type: string | undefined
    if (typeof entry === 'string') {
      const at = entry.indexOf(':')
      if (at > 0) {
        type = entry.slice(0, at)
        id = entry.slice(at + 1)
      } else {
        id = entry
        type = 'team_member'
      }
    } else if (entry && typeof entry === 'object') {
      id = typeof entry.id === 'string' ? entry.id : undefined
      type = typeof entry.type === 'string' ? entry.type : undefined
    }
    if (!id) continue
    const resolved =
      type === 'contact' ? 'contact'
      : type === 'team_member' || type === 'team' || type === undefined ? 'team_member'
      : null
    if (!resolved) continue
    const key = `${resolved}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, type: resolved })
  }
  return out
}

// ── POST /api/admin/conversations ───────────────────────────────────────────
// Create a new conversation.
// Body: { type, name?, orgId?, visibility, participantIds: [{id, type}] }
export async function POST(req: NextRequest) {
  try {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: {
      type?: string
      name?: string
      orgId?: string
      requestId?: string
      visibility?: string
      /**
       * Either `[{ id, type }]` or a flat `['team_member:<id>', ...]`.
       *
       * The flat form is what the hidden Messages page and the MCP
       * `create_conversation` tool have always sent, and reading `p.id` off a
       * string produced `participantId: undefined` on every extra
       * participant: the conversation row and the creator row were already
       * written by then, so the request 500'd and left an orphan behind
       * (swept by migration 0092). Both shapes are normalised now, and an
       * entry that resolves to nothing is DROPPED rather than inserted as a
       * row nobody can be.
       */
      participantIds?: Array<{ id?: string; type?: string } | string>
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
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

    // A conversation may only be attached to a client (directly, or through a
    // request) the caller can see. Internal threads carry no orgId and are
    // always allowed.
    const scope = await scopedOrgIds({ userId, orgId })
    if (!isOrgInScope(scope, convOrgId ?? null, 'allow')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (requestId) {
      const [linkedRequest] = await (database as unknown as D1)
        .select({ orgId: schema.requests.orgId })
        .from(schema.requests)
        .where(eq(schema.requests.id, requestId))
        .limit(1)
      if (linkedRequest && !isOrgInScope(scope, linkedRequest.orgId, 'allow')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Resolve the current user's team member ID
    const teamMemberRows = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)

    const creatorParticipantId = teamMemberRows.length > 0 ? teamMemberRows[0].id : userId

    const now = new Date().toISOString()

    // AN ORG CHANNEL IS FIND-OR-CREATE, not create. There is exactly one
    // standing line per client (migration 0092 puts a UNIQUE index on it), so
    // a second call for a client that already has one would trip the
    // constraint and answer 500. It goes through resolveOrgChannel instead,
    // the same resolver /api/admin/messages and the portal use, and returns
    // the existing room. The name and visibility the caller sent are ignored
    // on this type: a standing line is named after its client and is always
    // external, which is what makes it the room both audiences are reading.
    let convId: string
    if (type === 'org_channel' && convOrgId) {
      const channelId = await resolveOrgChannel(database as unknown as D1, convOrgId, {
        create: true,
        createdById: userId,
      })
      if (!channelId) {
        return NextResponse.json({ error: 'Could not resolve the org channel' }, { status: 409 })
      }
      convId = channelId
    } else {
      convId = crypto.randomUUID()
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
    }

    // Add the creator as an admin participant
    try {
      await database.insert(schema.conversationParticipants).values({
        id: crypto.randomUUID(),
        conversationId: convId,
        participantId: creatorParticipantId,
        participantType: 'team_member',
        role: 'admin',
        joinedAt: now,
      })
    } catch {
      // Already in the room, on a channel that was found rather than created.
    }

    // Add other participants, from either accepted shape.
    for (const seed of normaliseParticipantSeeds(participantIds ?? [])) {
      if (seed.id === creatorParticipantId) continue
      try {
        await database.insert(schema.conversationParticipants).values({
          id: crypto.randomUUID(),
          conversationId: convId,
          participantId: seed.id,
          participantType: seed.type,
          role: 'member',
          joinedAt: now,
        })
      } catch {
        // The unique index added by migration 0092 caught the same person
        // twice in one payload. They are in the room either way.
      }
    }

    return NextResponse.json({ id: convId }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/conversations]', err)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
