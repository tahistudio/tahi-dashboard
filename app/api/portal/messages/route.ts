/**
 * GET /api/portal/messages
 *
 * The client's left pane: their standing line to the studio, plus a thread for
 * every request they can open.
 *
 * The channel is resolved with `create: false`. A client opening a page must
 * not write a row, so an org that has never been messaged comes back with a
 * SYNTHETIC channel entry (source 'channel', id '', no messages) and the page
 * renders the room with an empty state. The real row is minted by the first
 * POST, and the unique index in migration 0092 makes that safe under two tabs.
 *
 * Nothing about internal notes, deleted messages, other brands or Tahi-internal
 * requests is decided here: lib/messages-store.ts owns those rules for both
 * audiences at once, so the studio inbox and this one cannot drift apart.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  loadClientScope,
  loadInboxThreads,
  loadOrgChannels,
  loadOrgNames,
} from '@/lib/messages-store'
import { threadKey } from '@/lib/messages-inbox'
import { gatePortalMessages, serviceOrgFromQuery } from './_shared'

export async function GET(req: NextRequest) {
  const gate = await gatePortalMessages(req, { write: false, serviceOrgId: serviceOrgFromQuery(req) })
  if (!gate.ok) return gate.response
  const { database, orgId, viewer, impersonating } = gate.ctx

  const [scope, channels, orgNames] = await Promise.all([
    loadClientScope(database, { clerkUserId: viewer.clerkUserId, orgId }),
    loadOrgChannels(database, [orgId]),
    loadOrgNames(database, [orgId]),
  ])

  const { threads } = await loadInboxThreads(database, {
    viewer: { ...viewer, domainId: scope.contactId ?? viewer.domainId },
    scope: { orgIds: [orgId], brandIds: scope.brandIds, audience: 'client' },
    channelsByOrg: channels,
    orgNames,
  })

  // The room exists as an idea before it exists as a row. Without this the
  // client's first visit shows a list with no way to start talking.
  const hasChannel = threads.some(t => t.source === 'channel')
  if (!hasChannel) {
    threads.unshift({
      key: threadKey('channel', ''),
      source: 'channel',
      id: '',
      title: 'Tahi Studio',
      requestNumber: null,
      status: null,
      orgId,
      orgName: null,
      lastMessage: null,
      unreadCount: 0,
      href: null,
      updatedAt: '',
    })
  }

  return NextResponse.json({
    threads,
    audience: 'client',
    readOnly: impersonating,
    orgName: orgNames.get(orgId) ?? null,
  })
}
