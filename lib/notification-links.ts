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

/**
 * Resolve where a notification click should take the user. Returns null when
 * the entity has no navigable route (the bell then just marks it read).
 * Entities with a detail page deep-link to it; list-only surfaces (messages,
 * calls, announcements) land on the list.
 */
export function notificationHref(
  entityType: NotificationEntityType | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!entityType) return null
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
    case 'message':      return '/messages'
    case 'call':         return '/calls'
    case 'announcement': return '/announcements'
    case 'subscription': return '/billing'
    default:             return null
  }
}
