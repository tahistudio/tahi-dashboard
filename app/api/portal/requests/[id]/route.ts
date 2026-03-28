import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/portal/requests/[id] ────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Scoped to own org
  const [request] = await drizzle
    .select()
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

  // Messages : client only sees non-internal
  const msgs = await drizzle
    .select({
      id: schema.messages.id,
      authorId: schema.messages.authorId,
      authorType: schema.messages.authorType,
      body: schema.messages.body,
      isInternal: schema.messages.isInternal,
      editedAt: schema.messages.editedAt,
      createdAt: schema.messages.createdAt,
      teamMemberName: schema.teamMembers.name,
    })
    .from(schema.messages)
    .leftJoin(
      schema.teamMembers,
      and(
        eq(schema.messages.authorId, schema.teamMembers.id),
        eq(schema.messages.authorType, 'team_member')
      )
    )
    .where(and(
      eq(schema.messages.requestId, id),
      eq(schema.messages.isInternal, false),
    ))
    .orderBy(asc(schema.messages.createdAt))

  return NextResponse.json({ request, messages: msgs })
}

// ── POST messages via portal (reuse admin route pattern) ─────────────────────
// Clients post to /api/portal/requests/[id]/messages : kept separate file
