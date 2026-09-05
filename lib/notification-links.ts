/**
 * lib/notification-links.ts
 *
 * Client-safe (no DB imports) home for the notification taxonomy and the
 * entity -> route resolver. Both the server helper (lib/notifications.ts) and
 * the notification bell import from here, so the event / entity vocabulary and
 * the deep-link targets can never drift apart.
 *
 * To make a new thing notifiable: add its event to NotificationEventType, its
 * entity to NotificationEntityType, and a case to notificationHref. Then any
 * createNotification({ type, entityType, entityId }) call renders in the bell
 * and deep-links on click, with no other wiring.
 */

export type NotificationEventType =
  | 'request_status_changed'
  | 'request_created'
  | 'new_message'
  | 'task_assigned'
  | 'task_status_changed'
  | 'invoice_created'
  | 'invoice_paid'
  | 'invoice_overdue'
  | 'proposal_sent'
  | 'proposal_signed'
  | 'contract_sent'
  | 'contract_signed'
  | 'call_scheduled'
  | 'deal_stage_changed'
  | 'lead_assigned'
  | 'schedule_published'
  | 'announcement_posted'
  | 'retainer_churn_risk'
  | 'retainer_upsell_opportunity'
  | 'delivery_off_track'
  | 'subscription_change_requested'
  | 'lead_high_intent'
  | 'lead_idle_qualifying'
  | 'affiliate_reactivation'
  | 'finance_anomaly'
  | 'daily_summary'
  | 'content_ideation'
  | 'cron_failed'

export type NotificationEntityType =
  | 'request'
  | 'task'
  | 'message'
  | 'invoice'
  | 'organisation'
  | 'contract'
  | 'proposal'
  | 'call'
  | 'deal'
  | 'lead'
  | 'schedule'
  | 'announcement'
  | 'subscription'
  | 'affiliate'
  | 'finance_anomaly'
  | 'system'
  | 'content_week'
  | 'cron'

/**
 * Who is clicking. The two audiences do not share a route map: most admin
 * surfaces 403 or redirect a client session, so one map for both meant a
 * client's bell threw them at a page they cannot open.
 */
export type NotificationAudience = 'team' | 'client'

/**
 * Team (Tahi org) route map. Entities with a detail page deep-link to it;
 * list-only surfaces (calls, announcements) land on the list.
 */
function teamHref(
  entityType: NotificationEntityType,
  entityId: string | null | undefined,
): string | null {
  switch (entityType) {
    case 'request':      return entityId ? `/requests/${entityId}` : '/requests'
    case 'task':         return entityId ? `/tasks/${entityId}` : '/tasks'
    case 'invoice':      return entityId ? `/invoices/${entityId}` : '/invoices'
    case 'organisation': return entityId ? `/clients/${entityId}` : '/clients'
    case 'contract':     return entityId ? `/contracts/${entityId}` : '/contracts'
    case 'proposal':     return entityId ? `/proposals/${entityId}` : '/proposals'
    case 'deal':         return entityId ? `/deals/${entityId}` : '/deals'
    case 'lead':         return entityId ? `/leads/${entityId}` : '/leads'
    case 'schedule':     return entityId ? `/schedules/${entityId}` : '/schedules'
    // Comms ride request threads for both audiences. /messages redirects
    // (an admin to /overview, a client to /requests), so pointing a bell row
    // there was a notification that vanished on click. The resolver cannot do
    // better than the list here: a 'message' notification carries the
    // CONVERSATION id, never the request id. Replies on a request thread are
    // already emitted as entityType 'request' and deep-link through the case
    // above, so this branch only catches standalone conversations.
    case 'message':      return '/requests'
    case 'call':         return '/calls'
    case 'announcement': return '/announcements'
    case 'subscription': return '/billing'
    // Cron / operator surfaces: entity ids are synthetic keys (cron:name,
    // affiliate:code, week:label), so these land on the owning page.
    case 'affiliate':       return '/leads'
    case 'finance_anomaly': return '/financial-reports'
    case 'content_week':    return '/content-studio?tab=ideas'
    case 'cron':            return '/settings/crons'
    case 'system':          return null
    default:             return null
  }
}

/**
 * Client portal route map. Only routes whose page renders for a client session
 * appear here; everything else resolves to null so the bell marks the row read
 * without a bounce.
 *
 * Deliberate nulls: tasks are not a client surface (DECISIONS.md), and
 * /schedules, /contracts, /proposals, /calls, /clients, /deals, /leads all
 * redirect a client back to /requests.
 *
 * `invoice` lands on the portal list rather than /invoices/{id}: the invoice
 * detail page still fetches /api/admin/invoices, which 403s a client. Make it
 * a deep link in the same change that gives the detail page a portal branch.
 */
function clientHref(
  entityType: NotificationEntityType,
  entityId: string | null | undefined,
): string | null {
  switch (entityType) {
    case 'request':      return entityId ? `/requests/${entityId}` : '/requests'
    case 'invoice':      return '/invoices'
    case 'subscription': return '/billing'
    // Their own workspace: name, brands, people and plan all live in settings.
    case 'organisation': return '/settings'
    // Client comms ride request threads; /messages redirects them to /requests.
    case 'message':      return '/requests'
    // Announcements render as banners on the portal home.
    case 'announcement': return '/overview'
    case 'task':
    case 'contract':
    case 'proposal':
    case 'deal':
    case 'lead':
    case 'schedule':
    case 'call':
    case 'affiliate':
    case 'finance_anomaly':
    case 'content_week':
    case 'cron':
    case 'system':
      return null
    default:             return null
  }
}

/**
 * Resolve where a notification click should take the user, for their audience.
 * Returns null when the entity has no navigable route for them (the bell then
 * just marks it read).
 *
 * Defaults to the team map so existing callers keep their behaviour; the bell
 * passes the real audience.
 */
export function notificationHref(
  entityType: NotificationEntityType | null | undefined,
  entityId: string | null | undefined,
  audience: NotificationAudience = 'team',
): string | null {
  if (!entityType) return null
  return audience === 'client'
    ? clientHref(entityType, entityId)
    : teamHref(entityType, entityId)
}
