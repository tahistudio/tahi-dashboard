import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as { body?: string; isInternal?: boolean }

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
    orgId: request.orgId,
    authorId: member?.id ?? userId ?? 'unknown',
    authorType: 'team_member',
    body: body.body.trim(),
    isInternal: body.isInternal ?? false,
  })

  // Update request updatedAt
  await drizzle
    .update(schema.requests)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.requests.id, id))

  return NextResponse.json({ id: msgId }, { status: 201 })
}
