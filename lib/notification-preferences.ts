/**
 * lib/notification-preferences.ts
 *
 * Per-user, per-event, per-channel notification preference resolution.
 *
 * Storage lives in the `notification_preferences` table (one row per
 * userId x userType x eventType x channel). A row with eventType `'*'` is the
 * per-user default for that channel; a hardcoded policy is the final fallback.
 *
 * Resolution order for (userId, userType, eventType, channel):
 *   1. exact row (userId, userType, eventType, channel)
 *   2. per-user default row (userId, userType, '*', channel)
 *   3. hardcoded channel default (DEFAULT_ENABLED)
 *
 * Read paths (the settings UI) go through the portal/admin endpoints; send
 * paths (lib/notifications.ts, email, slack) call the resolvers here so a
 * preference is honoured everywhere without per-call-site plumbing.
 */

import { schema } from '@/db/d1'
import { and, eq, inArray } from 'drizzle-orm'
import type { NotificationEventType } from './notification-links'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type NotificationChannel = 'in_app' | 'email' | 'slack'
export type PreferenceUserType = 'team_member' | 'contact'

/**
 * The event types the preferences UI and endpoints accept. This is the subset
 * of NotificationEventType that maps to a client/team-facing toggle group; the
 * wildcard `'*'` per-user default row is also accepted on write.
 */
export const PREF_EVENT_TYPES: readonly NotificationEventType[] = [
  'request_status_changed',
  'request_created',
  'new_message',
  'invoice_created',
  'invoice_paid',
  'invoice_overdue',
  'announcement_posted',
]

export const PREF_CHANNELS: readonly NotificationChannel[] = ['in_app', 'email', 'slack']

/**
 * Hardcoded final fallback when a user has neither an exact nor a `'*'` row.
 * in_app and email default on; slack is off unless explicitly enabled (matches
 * the previous workspace behaviour where Slack was off unless 'true').
 */
export const DEFAULT_ENABLED: Record<NotificationChannel, boolean> = {
  in_app: true,
  email: true,
  slack: false,
}

interface PrefRow {
  userId: string
  userType: string
  eventType: string
  channel: string
  enabled: boolean
}

/**
 * Resolve enablement for one recipient from an already-fetched set of rows,
 * applying the exact -> per-user-default -> hardcoded fallback order.
 */
function resolveFromRows(
  rows: PrefRow[],
  userId: string,
  userType: string,
  eventType: string,
  channel: NotificationChannel,
): boolean {
  const exact = rows.find(
    (r) =>
      r.userId === userId &&
      r.userType === userType &&
      r.eventType === eventType &&
      r.channel === channel,
  )
  if (exact) return exact.enabled

  const wildcard = rows.find(
    (r) =>
      r.userId === userId &&
      r.userType === userType &&
      r.eventType === '*' &&
      r.channel === channel,
  )
  if (wildcard) return wildcard.enabled

  return DEFAULT_ENABLED[channel]
}

/**
 * Is a single (userId, userType, eventType) enabled for a given channel?
 * Defaults to the channel policy (send) if the lookup fails, so a preference
 * store hiccup never silently swallows notifications.
 */
export async function isEventChannelEnabled(
  database: DrizzleDB,
  userId: string,
  userType: PreferenceUserType,
  eventType: NotificationEventType,
  channel: NotificationChannel,
): Promise<boolean> {
  try {
    const rows = await database
      .select({
        userId: schema.notificationPreferences.userId,
        userType: schema.notificationPreferences.userType,
        eventType: schema.notificationPreferences.eventType,
        channel: schema.notificationPreferences.channel,
        enabled: schema.notificationPreferences.enabled,
      })
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.userId, userId),
          eq(schema.notificationPreferences.userType, userType),
          eq(schema.notificationPreferences.channel, channel),
          inArray(schema.notificationPreferences.eventType, [eventType, '*']),
        ),
      )
    return resolveFromRows(rows, userId, userType, eventType, channel)
  } catch {
    return DEFAULT_ENABLED[channel]
  }
}

/**
 * Filter a recipient list down to those who have the `in_app` channel enabled
 * for the given event type. Used centrally by the notification emitters so a
 * user who muted an event never gets a bell row. On any failure it returns the
 * recipients unchanged (fail-open: better a stray ping than a silenced one).
 */
export async function filterRecipientsByInAppPref<
  T extends { userId: string; userType: PreferenceUserType },
>(
  database: DrizzleDB,
  recipients: T[],
  eventType: NotificationEventType,
): Promise<T[]> {
  if (recipients.length === 0) return recipients
  try {
    const userIds = [...new Set(recipients.map((r) => r.userId))]
    const rows = await database
      .select({
        userId: schema.notificationPreferences.userId,
        userType: schema.notificationPreferences.userType,
        eventType: schema.notificationPreferences.eventType,
        channel: schema.notificationPreferences.channel,
        enabled: schema.notificationPreferences.enabled,
      })
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.channel, 'in_app'),
          inArray(schema.notificationPreferences.userId, userIds),
          inArray(schema.notificationPreferences.eventType, [eventType, '*']),
        ),
      )
    if (rows.length === 0) return recipients
    return recipients.filter((r) =>
      resolveFromRows(rows, r.userId, r.userType, eventType, 'in_app'),
    )
  } catch {
    return recipients
  }
}
