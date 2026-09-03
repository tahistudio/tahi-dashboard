import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Voice notes hang off this request's messages, so both handlers resolve the
 *  owning request's org and check the caller's scope before they run. */
async function guardRequestAccess(
  database: Drizzle,
  userId: string | null,
  requestId: string,
): Promise<NextResponse | null> {
  const [owner] = await database
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
  if (!owner) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return requireAccessToOrg(database, userId, owner.orgId)
}

// GET /api/admin/requests/[id]/voice-notes
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardRequestAccess(drizzle, userId, requestId)
  if (denied) return denied

  // Get voice notes for messages belonging to this request
  const messages = await drizzle
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.requestId, requestId))

  const messageIds = messages.map(m => m.id)
  if (messageIds.length === 0) {
    return NextResponse.json({ items: [] })
  }

  const items = []
  for (const msgId of messageIds) {
    const notes = await drizzle
      .select()
      .from(schema.voiceNotes)
      .where(eq(schema.voiceNotes.messageId, msgId))
    items.push(...notes)
  }

  return NextResponse.json({ items })
}

// POST /api/admin/requests/[id]/voice-notes
// Body: { messageId, storageKey, durationSeconds?, mimeType? }
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const body = await req.json().catch(() => null) as {
    messageId?: string
    storageKey?: string
    durationSeconds?: number
    mimeType?: string
  } | null

  if (!body?.messageId || !body.storageKey) {
    return NextResponse.json({ error: 'messageId and storageKey are required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardRequestAccess(drizzle, userId, requestId)
  if (denied) return denied

  // The message has to be on the request in the path, or a note could be
  // hung off another client's message through an in-scope request id.
  const [message] = await drizzle
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.id, body.messageId),
      eq(schema.messages.requestId, requestId),
    ))
    .limit(1)
  if (!message) {
    return NextResponse.json({ error: 'Message not found on this request' }, { status: 404 })
  }

  const id = crypto.randomUUID()
  await drizzle.insert(schema.voiceNotes).values({
    id,
    messageId: body.messageId,
    storageKey: body.storageKey,
    durationSeconds: body.durationSeconds ?? null,
    mimeType: body.mimeType ?? 'audio/ogg',
  })

  return NextResponse.json({ id })
}
