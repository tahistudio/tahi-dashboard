/**
 * GET /api/admin/messages
 *
 * The studio inbox: the same anatomy as the client's, over every client the
 * caller is scoped to, plus the list the client switcher is drawn from.
 *
 *   ?orgId=<id>   narrow to one client. Re-checked against the caller's scope,
 *                 so the switcher cannot be used to reach a client the rail
 *                 would not show.
 *
 * The studio sees the WHOLE room: internal notes included, and Tahi-internal
 * requests too. lib/messages-store.ts decides that from `audience: 'studio'`,
 * which is also what makes the client's version of this endpoint incapable of
 * returning either.
 *
 * Org channels are read with `create: false`. A client the studio has never
 * messaged has no row, and looking at an inbox must not create one. Instead,
 * exactly as the portal does, a client with no channel row gets a SYNTHETIC
 * row carrying the ORGANISATION id rather than a conversation id: the thread
 * route's channel branch falls through to the organisations lookup, scope
 * checks it, and mints the room on the first POST. Without this the studio
 * could only ever answer a line the client had opened first, which is not what
 * a standing client line is.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadInboxThreads, loadOrgChannels, loadOrgNames } from '@/lib/messages-store'
import { threadKey, totalUnread, type InboxThread } from '@/lib/messages-inbox'
import { gateAdminMessages, inboxOrgIds } from './_shared'

export async function GET(req: NextRequest) {
  const gate = await gateAdminMessages(req)
  if (!gate.ok) return gate.response
  const { database, scope, viewer } = gate.ctx

  const only = new URL(req.url).searchParams.get('orgId')
  const orgIds = await inboxOrgIds(database, scope, only)
  if (orgIds.length === 0) {
    return NextResponse.json({ threads: [], clients: [], audience: 'studio', unread: 0 })
  }

  const [channels, orgNames] = await Promise.all([
    loadOrgChannels(database, orgIds),
    loadOrgNames(database, orgIds),
  ])

  const { threads } = await loadInboxThreads(database, {
    viewer,
    scope: { orgIds, brandIds: null, audience: 'studio' },
    channelsByOrg: channels,
    orgNames,
  })

  // Every client the caller can see has a standing line, whether or not
  // anybody has written on it yet. The id is the ORG id: the thread route
  // accepts either an org channel's conversation id or an organisation id on
  // this source, and only the POST turns the second into the first.
  const withChannel = new Set(threads.filter(t => t.source === 'channel').map(t => t.orgId))
  const placeholders: InboxThread[] = orgIds
    .filter(id => !withChannel.has(id))
    .map(id => ({
      key: threadKey('channel', id),
      source: 'channel' as const,
      id,
      title: orgNames.get(id) ?? 'Client',
      requestNumber: null,
      status: null,
      orgId: id,
      orgName: orgNames.get(id) ?? null,
      lastMessage: null,
      unreadCount: 0,
      href: null,
      updatedAt: '',
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
  // After the client lines that have traffic and before the request threads,
  // so a quiet placeholder never outranks a room somebody is talking in.
  const firstRequest = threads.findIndex(t => t.source === 'request')
  threads.splice(firstRequest === -1 ? threads.length : firstRequest, 0, ...placeholders)

  // The switcher counts unread per client off the threads that were just
  // built, so the number on a client's name and the number on its rows are
  // the same arithmetic rather than two queries that can disagree.
  const unreadByOrg = new Map<string, number>()
  for (const t of threads) {
    unreadByOrg.set(t.orgId, (unreadByOrg.get(t.orgId) ?? 0) + t.unreadCount)
  }
  const clients = orgIds
    .map(id => ({ id, name: orgNames.get(id) ?? 'Client', unread: unreadByOrg.get(id) ?? 0 }))
    .sort((a, b) => (b.unread - a.unread) || a.name.localeCompare(b.name))

  return NextResponse.json({
    threads,
    clients,
    audience: 'studio',
    unread: totalUnread(threads),
    orgId: only ?? null,
  })
}
