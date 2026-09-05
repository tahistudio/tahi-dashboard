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
import {
  clientStatusEmailPlan,
  loadRequestEmailContext,
  type NotificationEmailPlan,
} from '@/lib/notification-email'
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
  /**
   * requests.brand_id, when the caller read it. Present (string or null) and
   * the client fan-out is narrowed to the contacts the brand-scoped portal
   * list would show this row to; absent and it stays org wide, which is what
   * every caller did before.
   */
  brandId?: string | null
}

export interface RequestStatusEffectOptions {
  /**
   * May this move put an email in the client's inbox? Default true, which is
   * right for a single request moving.
   *
   * A batch caller must pass false. The bulk PATCH calls this once per row, so
   * a twenty row "Mark delivered" for a client with three contacts is sixty
   * separate emails to the same three people, sequentially, and Resend's two a
   * second ceiling refuses most of them. The bell entries are cheap and stay.
   */
  clientEmail?: boolean
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
 * The only two moves that earn a place in a client's inbox.
 *
 * Both are a hand-off: the work is finished and the next action is theirs.
 * in_review and in_progress are studio housekeeping, and mailing those is how
 * a client learns to filter us, which costs us the two that matter. They still
 * produce a bell row, which is the right weight for "we picked it up".
 */
const CLIENT_EMAIL_STATUSES = ['client_review', 'delivered'] as const
type ClientEmailStatus = (typeof CLIENT_EMAIL_STATUSES)[number]

export function isClientEmailStatus(status: string): status is ClientEmailStatus {
  return (CLIENT_EMAIL_STATUSES as readonly string[]).includes(status)
}

/**
 * What the client is told, in their own terms. "Request X status changed to
 * client review" is a column name read aloud; these are the two sentences that
 * say what they have to do about it.
 */
function clientStatusCopy(title: string, status: string): { title: string; body: string } {
  if (status === 'client_review') {
    return {
      title: 'Your request is ready for your review',
      body: `"${title}" is finished and waiting on your approval.`,
    }
  }
  if (status === 'delivered') {
    return {
      title: 'Your request has been delivered',
      body: `"${title}" is done and ready to view.`,
    }
  }
  return {
    title: `Your request "${title}" moved to ${status.replace(/_/g, ' ')}`,
    body: 'We will let you know as soon as there is something for you to look at.',
  }
}

/**
 * Notify + emit for one request whose status just changed.
 *
 * @param status the status now stored on the row (for a bulk archive that is
 *               'archived', not the caller's `archived: true` flag).
 * @param options `clientEmail: false` from any caller in a loop.
 */
export async function emitRequestStatusChanged(
  database: DrizzleDB,
  request: RequestStatusSubject,
  status: string,
  options?: RequestStatusEffectOptions,
): Promise<void> {
  const statusLabel = status.replace(/_/g, ' ')

  // Notify the assignee (if one exists). assigneeId is a teamMembers.id;
  // notifyTeamMember resolves it to the Clerk user id the bell queries.
  // Studio wording: the team reads status names all day, the client does not.
  if (request.assigneeId) {
    await notifyTeamMember(database, request.assigneeId, {
      type: 'request_status_changed',
      title: `Request "${request.title}" status changed to ${statusLabel}`,
      body: `Status is now "${statusLabel}"`,
      entityType: 'request',
      entityId: request.id,
    })
  }

  // Notify contacts at the client org (bell rows skip those without a linked
  // login, email does not), unless the request is Tahi-internal or the move is
  // housekeeping the client has no stake in.
  if (!request.isInternal && !CLIENT_SILENT_STATUSES.includes(status)) {
    const copy = clientStatusCopy(request.title, status)
    // The subject prefix and the client company name are looked up here rather
    // than passed in so both PATCH paths get them without either call site
    // having to remember. One read, and only paid for on the two statuses that
    // actually send.
    let email: NotificationEmailPlan | undefined
    if ((options?.clientEmail ?? true) && isClientEmailStatus(status)) {
      const context = await loadRequestEmailContext(database, request.id)
      email = clientStatusEmailPlan({
        status,
        requestId: request.id,
        requestTitle: request.title,
        requestNumber: context.requestNumber,
        clientName: context.orgName,
      })
    }

    await notifyOrgContacts(
      database,
      request.orgId,
      {
        type: 'request_status_changed',
        title: copy.title,
        body: copy.body,
        entityType: 'request',
        entityId: request.id,
        email,
      },
      // Only scope when the caller actually read the column. Treating an
      // unread column as "this request has no brand" would hide the move from
      // every brand-scoped contact at the org.
      request.brandId !== undefined ? { brandId: request.brandId } : undefined,
    )
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
