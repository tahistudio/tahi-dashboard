import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/requests/[id]/voice-notes
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await params
  const body = await req.json() as {
    messageId?: string
    storageKey?: string
    durationSeconds?: number
    mimeType?: string
  }

  if (!body.messageId || !body.storageKey) {
    return NextResponse.json({ error: 'messageId and storageKey are required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
