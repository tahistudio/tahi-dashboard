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
import { eq } from 'drizzle-orm'
import {
  filterRecipientsByInAppPref,
  isEventChannelEnabled,
} from './notification-preferences'

// The event / entity vocabulary and the deep-link resolver live in a
// client-safe module so the bell and this helper share one source of truth.
// Re-exported here so existing importers of these types keep working.
export type { NotificationEventType, NotificationEntityType } from './notification-links'
import type { NotificationEventType, NotificationEntityType } from './notification-links'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
    // Honour the recipient's in-app preference for this event. A muted user
    // gets no bell row; on any lookup failure isEventChannelEnabled fails open.
    const allowed = await isEventChannelEnabled(
      database,
      params.userId,
      params.userType,
      params.type,
      'in_app',
    )
    if (!allowed) return

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
 * Notify someone they were @-mentioned in a message / task / request.
 *
 * The mention id from the composer is a team_member or contact row
 * id, NOT a Clerk user id. The notifications bell queries by Clerk
 * user id, so we resolve here so the recipient actually sees the
 * ping.
 *
 * Skips when the mention id matches the sender id (no self-pings).
 * Silently no-ops if the mention id can't be resolved to a Clerk
 * user, e.g. team members that haven't been invited yet.
 */
export async function notifyMentionedPerson(
  database: DrizzleDB,
  params: {
    mentionedId: string
    /** team_members.id of the user who sent the mention. */
    senderTeamMemberId: string
    title: string
    body?: string | null
    entityType: NotificationEntityType
    entityId: string
  },
): Promise<void> {
  if (params.mentionedId === params.senderTeamMemberId) return

  try {
    // Try team member first.
    const tm = await database
      .select({ clerkUserId: schema.teamMembers.clerkUserId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, params.mentionedId))
      .limit(1)
    if (tm.length > 0 && tm[0].clerkUserId) {
      await createNotification(database, {
        userId: tm[0].clerkUserId,
        userType: 'team_member',
        type: 'new_message',
        title: params.title,
        body: params.body ?? null,
        entityType: params.entityType,
        entityId: params.entityId,
      })
      return
    }

    // Fall back to contacts (portal users).
    const ct = await database
      .select({ clerkUserId: schema.contacts.clerkUserId })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, params.mentionedId))
      .limit(1)
    if (ct.length > 0 && ct[0].clerkUserId) {
      await createNotification(database, {
        userId: ct[0].clerkUserId,
        userType: 'contact',
        type: 'new_message',
        title: params.title,
        body: params.body ?? null,
        entityType: params.entityType,
        entityId: params.entityId,
      })
    }
  } catch (err) {
    console.error('[notifyMentionedPerson] failed:', err)
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
    // Drop recipients who muted this event's in-app channel before inserting.
    const targets = await filterRecipientsByInAppPref(
      database,
      recipients,
      shared.type,
    )
    if (targets.length === 0) return

    const now = new Date().toISOString()
    const rows = targets.map((r) => ({
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

type NotificationPayload = {
  type: NotificationEventType
  title: string
  body?: string | null
  entityType?: NotificationEntityType | null
  entityId?: string | null
}

/**
 * Notify every Tahi team member with a linked Clerk account. The audience
 * emitter for internal events (new request, delivery off track, invoice paid).
 * One call, no recipient plumbing at the call site.
 */
export async function notifyAllAdmins(
  database: DrizzleDB,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const members = await database
      .select({ clerkUserId: schema.teamMembers.clerkUserId })
      .from(schema.teamMembers)
    const recipients = members
      .filter((m): m is { clerkUserId: string } => !!m.clerkUserId)
      .map((m) => ({ userId: m.clerkUserId, userType: 'team_member' as const }))
    await createNotifications(database, recipients, payload)
  } catch (err) {
    console.error('[notifyAllAdmins] failed:', err)
  }
}

/**
 * Notify every contact at a client org with a linked Clerk account. The
 * audience emitter for client-facing events (status changed, message posted,
 * invoice sent). Contacts without a Clerk login yet are skipped.
 */
export async function notifyOrgContacts(
  database: DrizzleDB,
  orgId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const contacts = await database
      .select({ clerkUserId: schema.contacts.clerkUserId })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId))
    const recipients = contacts
      .filter((c): c is { clerkUserId: string } => !!c.clerkUserId)
      .map((c) => ({ userId: c.clerkUserId, userType: 'contact' as const }))
    await createNotifications(database, recipients, payload)
  } catch (err) {
    console.error('[notifyOrgContacts] failed:', err)
  }
}
