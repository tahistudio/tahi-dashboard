/**
 * POST /api/admin/messages/<source>/<id>/read
 *
 * The studio half of the read cursor. Same split as the client's
 * (lib/messages-store.ts markThreadRead):
 *   request  request_reads, keyed on the Clerk user id + userType 'team_member'
 *   channel  conversation_participants.last_read_at, keyed on teamMembers.id
 *
 * Explicit, never a GET side effect, so the "New" line survives the read that
 * drew it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { isInboxSource } from '@/lib/messages-inbox'
import { markThreadRead } from '@/lib/messages-store'
import { ORG_CHANNEL_TYPE } from '@/lib/org-channel'
import { gateAdminMessages, refuseOutOfScope } from '../../../_shared'

type Params = { params: Promise<{ source: string; id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { source, id } = await params
  if (!isInboxSource(source)) {
    return NextResponse.json({ error: 'Unknown thread' }, { status: 404 })
  }

  const gate = await gateAdminMessages(req)
  if (!gate.ok) return gate.response
  const { database, scope, viewer } = gate.ctx

  // The owning org is read from the row, then scope-checked, so a cursor can
  // never be stamped on a client the caller is not allowed to see.
  if (source === 'channel') {
    const [conversation] = await database
      .select({ id: schema.conversations.id, orgId: schema.conversations.orgId })
      .from(schema.conversations)
      .where(and(
        eq(schema.conversations.id, id),
        eq(schema.conversations.type, ORG_CHANNEL_TYPE),
      ))
      .limit(1)
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const denied = refuseOutOfScope(scope, conversation.orgId)
    if (denied) return denied
    const lastReadAt = await markThreadRead(database, { source: 'channel', id: conversation.id, viewer })
    return NextResponse.json({ ok: true, lastReadAt })
  }

  const [request] = await database
    .select({ id: schema.requests.id, orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = refuseOutOfScope(scope, request.orgId)
  if (denied) return denied

  const lastReadAt = await markThreadRead(database, { source: 'request', id: request.id, viewer })
  return NextResponse.json({ ok: true, lastReadAt })
}
