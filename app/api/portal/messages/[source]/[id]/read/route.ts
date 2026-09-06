/**
 * POST /api/portal/messages/<source>/<id>/read
 *
 * Move the client's read cursor on one thread. Explicit, never a GET side
 * effect: the thread pane draws a single "New" line at the first previously
 * unread message, and a GET that stamped the cursor would erase that line in
 * the same paint that drew it.
 *
 * Two cursors, because the two stores key on different identities and always
 * have (lib/messages-store.ts markThreadRead owns the split):
 *   request  request_reads       keyed on the CLERK user id + userType
 *   channel  conversation_participants.last_read_at  keyed on contacts.id
 *
 * A read-only impersonation preview is refused. Clearing somebody else's
 * unread badge from inside a preview is exactly the kind of invisible write a
 * preview must not make.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isInboxSource } from '@/lib/messages-inbox'
import { markThreadRead } from '@/lib/messages-store'
import { resolveOrgChannel } from '@/lib/org-channel'
import { clientCanSeeRequest, loadClientScope } from '@/lib/messages-store'
import { gatePortalMessages, serviceOrgFromQuery } from '../../../_shared'

type Params = { params: Promise<{ source: string; id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { source, id } = await params
  if (!isInboxSource(source)) {
    return NextResponse.json({ error: 'Unknown thread' }, { status: 404 })
  }

  const gate = await gatePortalMessages(req, { write: true, serviceOrgId: serviceOrgFromQuery(req) })
  if (!gate.ok) return gate.response
  const { database, orgId, viewer } = gate.ctx

  if (source === 'channel') {
    // Resolved from the authenticated org, not from the path, so a client can
    // only ever stamp their own line. `create: false`: marking an empty room
    // read is a no-op, not a reason to write one.
    const channelId = await resolveOrgChannel(database, orgId, {
      create: false,
      createdById: viewer.clerkUserId,
    })
    if (!channelId) return NextResponse.json({ ok: true, lastReadAt: null })
    const lastReadAt = await markThreadRead(database, { source: 'channel', id: channelId, viewer })
    return NextResponse.json({ ok: true, lastReadAt })
  }

  const scope = await loadClientScope(database, { clerkUserId: viewer.clerkUserId, orgId })
  const request = await clientCanSeeRequest(database, { requestId: id, orgId, brandIds: scope.brandIds })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const lastReadAt = await markThreadRead(database, { source: 'request', id: request.id, viewer })
  return NextResponse.json({ ok: true, lastReadAt })
}
