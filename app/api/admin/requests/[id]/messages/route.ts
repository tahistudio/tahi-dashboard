import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'
import { createNotifications, createNotification } from '@/lib/notifications'
import { parseMentions } from '@/lib/parse-mentions'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/requests/[id]/messages ────────────────────────────────────
// Returns all messages for a request (admin sees internal + external).
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
    .where(eq(schema.messages.requestId, id))
    .orderBy(asc(schema.messages.createdAt))

  return NextResponse.json({ items: msgs, page: 1, limit: msgs.length })
}

// ── POST /api/admin/requests/[id]/messages ───────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    let body: { body?: string; isInternal?: boolean; conversationId?: string }
    try {
      body = await req.json() as { body?: string; isInternal?: boolean; conversationId?: string }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.body?.trim()) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
    }

    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    // Find the request to get orgId for message
    const [request] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1)

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    // Look up team member ID by Clerk user ID
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id })
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
      body: body.body.trim(),
      isInternal: body.isInternal ?? false,
    })

    // Update request updatedAt
    const msgNow = new Date().toISOString()
    await drizzle
      .update(schema.requests)
      .set({ updatedAt: msgNow })
      .where(eq(schema.requests.id, id))

    // Process @mentions and create mention rows + notifications
    const mentionedPeople = parseMentions(body.body.trim())
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
        if (m.id !== authorId) {
          await createNotification(drizzle, {
            userId: m.id,
            userType: m.type,
            type: 'new_message',
            title: 'You were mentioned in a request message',
            body: body.body.trim().slice(0, 200),
            entityType: 'request',
            entityId: id,
          })
        }
      }
    }

    // Notify client contacts about the new message (unless internal-only)
    if (!body.isInternal) {
      const contacts = await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, request.orgId))
        .limit(10)

      const recipients = contacts.map((c) => ({
        userId: c.id,
        userType: 'contact' as const,
      }))

      if (recipients.length > 0) {
        await createNotifications(drizzle, recipients, {
          type: 'new_message',
          title: 'New message on your request',
          body: body.body.trim().slice(0, 200),
          entityType: 'request',
          entityId: id,
        })
      }
    }

    // Notify request assignee about the new message (if sender is not the assignee)
    const [reqInfo] = await drizzle
      .select({ assigneeId: schema.requests.assigneeId, title: schema.requests.title })
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1)

    if (reqInfo?.assigneeId && reqInfo.assigneeId !== (member?.id ?? userId)) {
      await createNotifications(drizzle, [{ userId: reqInfo.assigneeId, userType: 'team_member' }], {
        type: 'new_message',
        title: `New message on "${reqInfo.title}"`,
        body: body.body.trim().slice(0, 200),
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
