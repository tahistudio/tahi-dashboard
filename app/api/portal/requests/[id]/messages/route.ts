import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// ── POST /api/portal/requests/[id]/messages ──────────────────────────────────
// Clients post messages to a request thread (always external — isInternal: false).
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as { body?: string }

  if (!body.body?.trim()) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify this request belongs to the client's org
  const [request] = await drizzle
    .select({ id: schema.requests.id, orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Look up contact record by Clerk user ID
  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  const msgId = crypto.randomUUID()
  await drizzle.insert(schema.messages).values({
    id: msgId,
    requestId: id,
    orgId,
    authorId: contact?.id ?? userId,
    authorType: 'contact',
    body: body.body.trim(),
    isInternal: false,
  })

  await drizzle
    .update(schema.requests)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.requests.id, id))

  return NextResponse.json({ id: msgId }, { status: 201 })
}
