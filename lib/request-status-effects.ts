/**
 * lib/request-status-effects.ts
 *
 * The side effects a request status change carries, in one place.
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
}

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

  // Notify contacts at the client org (skips those without a linked login).
  await notifyOrgContacts(database, request.orgId, payload)

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
