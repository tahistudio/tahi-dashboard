/**
 * lib/notifications.ts
 *
 * Helper to create notification rows in the database.
 * Call this from API route handlers when events occur
 * (status change, new message, task assignment, invoice creation, etc.).
 *
 * The SSE stream at /api/notifications/stream polls for new rows,
 * so inserting a row here is all that is needed for real-time delivery.
 */

import { schema } from '@/db/d1'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type NotificationEventType =
  | 'request_status_changed'
  | 'new_message'
  | 'task_assigned'
  | 'invoice_created'
  | 'request_created'

export type NotificationEntityType =
  | 'request'
  | 'message'
  | 'task'
  | 'invoice'

interface CreateNotificationParams {
  userId: string
  userType: 'team_member' | 'contact'
  type: NotificationEventType
  title: string
  body?: string | null
  entityType?: NotificationEntityType | null
  entityId?: string | null
}

/**
 * Insert a single notification row.
 * Swallows errors so that a notification failure never blocks the primary action.
 */
export async function createNotification(
  database: DrizzleDB,
  params: CreateNotificationParams,
): Promise<void> {
  try {
    await database.insert(schema.notifications).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      userType: params.userType,
      eventType: params.type,
      title: params.title,
      body: params.body ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      read: false,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    // Never let notification failures break the caller
    console.error('[createNotification] failed to insert notification:', err)
  }
}

/**
 * Insert multiple notification rows (one per recipient).
 * Useful when an event should notify several people at once.
 */
export async function createNotifications(
  database: DrizzleDB,
  recipients: Array<{ userId: string; userType: 'team_member' | 'contact' }>,
  shared: {
    type: NotificationEventType
    title: string
    body?: string | null
    entityType?: NotificationEntityType | null
    entityId?: string | null
  },
): Promise<void> {
  if (recipients.length === 0) return
  try {
    const now = new Date().toISOString()
    const rows = recipients.map((r) => ({
      id: crypto.randomUUID(),
      userId: r.userId,
      userType: r.userType,
      eventType: shared.type,
      title: shared.title,
      body: shared.body ?? null,
      entityType: shared.entityType ?? null,
      entityId: shared.entityId ?? null,
      read: false,
      createdAt: now,
    }))
    await database.insert(schema.notifications).values(rows)
  } catch (err) {
    console.error('[createNotifications] failed to insert notifications:', err)
  }
}
