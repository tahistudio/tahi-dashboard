/**
 * lib/request-status-effects.ts
 *
 * The side effects a request write carries, in one place: a status change
 * (emitRequestStatusChanged) and a create (emitRequestCreated).
 *
 * Moving a request is never just a column write: the assignee is notified,
 * the client's contacts are notified, and a `request_status_changed` domain
 * event fires so automation rules and outgoing webhooks see it. The single
 * PATCH (app/api/admin/requests/[id]) did all three; the bulk PATCH did none
 * of them, so five rows marked delivered together left five clients silent
 * while the same five done one at a time did not. Both paths now call this,
 * so they cannot drift again.
 *
 * Best effort by construction: notifyOrgContacts and dispatchDomainEvent both
 * swallow their own failures, so a notification problem never fails the write
 * that already landed.
 */

import { notifyOrgContacts, notifyTeamMember } from '@/lib/notifications'
import { dispatchDomainEvent } from '@/lib/events'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The row fields the effects need, re-read after the update landed. */
export interface RequestStatusSubject {
  id: string
  title: string
  orgId: string
  assigneeId: string | null
  /** A Tahi-internal request is never announced to the client's contacts:
   *  the portal hides the row, so the bell entry would carry an internal
   *  title and deep-link to a 404. */
  isInternal: boolean
}

/**
 * Statuses that are studio housekeeping rather than a delivery event, so the
 * client's contacts are not told about them.
 *
 * Archiving is the only one today. Nothing in the app produced a client-facing
 * 'archived' notification before the bulk PATCH started sharing this helper
 * (the single PATCH has no `archived` field), and a backlog clean-up is the
 * most likely first real use of the bulk bar: N stale rows would have pushed
 * one "status changed to archived" into every contact of every affected
 * client. The assignee notification and the domain event still fire, so
 * automations and webhooks see the move and the two PATCH paths stay
 * identical.
 */
const CLIENT_SILENT_STATUSES: readonly string[] = ['archived']

/**
 * Notify + emit for one request whose status just changed.
 *
 * @param status the status now stored on the row (for a bulk archive that is
 *               'archived', not the caller's `archived: true` flag).
 */
export async function emitRequestStatusChanged(
  database: DrizzleDB,
  request: RequestStatusSubject,
  status: string,
): Promise<void> {
  const statusLabel = status.replace(/_/g, ' ')
  const payload = {
    type: 'request_status_changed' as const,
    title: `Request "${request.title}" status changed to ${statusLabel}`,
    body: `Status is now "${statusLabel}"`,
    entityType: 'request' as const,
    entityId: request.id,
  }

  // Notify the assignee (if one exists). assigneeId is a teamMembers.id;
  // notifyTeamMember resolves it to the Clerk user id the bell queries.
  if (request.assigneeId) {
    await notifyTeamMember(database, request.assigneeId, payload)
  }

  // Notify contacts at the client org (skips those without a linked login),
  // unless the request is Tahi-internal or the move is housekeeping the
  // client has no stake in.
  if (!request.isInternal && !CLIENT_SILENT_STATUSES.includes(status)) {
    await notifyOrgContacts(database, request.orgId, payload)
  }

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(database, {
    type: 'request_status_changed',
    entityId: request.id,
    entityType: 'request',
    orgId: request.orgId,
    data: {
      status,
      title: request.title,
      assigneeId: request.assigneeId ?? null,
    },
  })
}

/** The fields a `request_created` domain event carries. */
export interface RequestCreatedSubject {
  id: string
  orgId: string
  title: string
  type: string
  category: string
  priority: string
  status: string
  isInternal: boolean
  /** Which create path filed it: the admin dialog, the cross-client bulk bar. */
  source: 'admin' | 'admin_bulk'
}

/**
 * Fire `request_created` for one new request.
 *
 * The single admin POST dispatched this from day one; the cross-client bulk
 * create returned straight after its insert loop, so a batch of ten requests
 * triggered no automation rule and no outgoing webhook while the same ten
 * filed one at a time triggered ten. Both paths call this now, for the same
 * reason the status effects were extracted: so they cannot drift again.
 */
export async function emitRequestCreated(
  database: DrizzleDB,
  request: RequestCreatedSubject,
): Promise<void> {
  await dispatchDomainEvent(database, {
    type: 'request_created',
    entityId: request.id,
    entityType: 'request',
    orgId: request.orgId,
    data: {
      title: request.title,
      type: request.type,
      category: request.category,
      priority: request.priority,
      status: request.status,
      isInternal: request.isInternal ? 1 : 0,
      source: request.source,
    },
  })
}
