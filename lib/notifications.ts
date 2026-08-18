/**
 * lib/notifications.ts
 *
 * Helpers to create notification rows in the database.
 * Call these from API route handlers when events occur
 * (status change, new message, task assignment, invoice creation, etc.).
 *
 * The SSE stream at /api/notifications/stream polls for new rows,
 * so inserting a row here is all that is needed for real-time delivery.
 *
 * Recipient identity: the bell and the SSE stream query notifications by
 * CLERK user id, so notifications.userId must always hold a Clerk user id.
 * Domain row ids (teamMembers.id, contacts.id, conversation participant ids)
 * must never be written there directly; rows keyed on them are invisible to
 * everyone. Call sites therefore pass typed recipients and this module
 * resolves them to Clerk user ids, skipping people without a linked login.
 */

import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import { filterRecipientsByInAppPref } from './notification-preferences'

// The event / entity vocabulary and the deep-link resolver live in a
// client-safe module so the bell and this helper share one source of truth.
// Re-exported here so existing importers of these types keep working.
export type { NotificationEventType, NotificationEntityType } from './notification-links'
import type { NotificationEventType, NotificationEntityType } from './notification-links'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type NotificationUserType = 'team_member' | 'contact'

/**
 * A notification target. Only the clerkUserId variant may carry a Clerk user
 * id; the other variants carry domain row ids and are resolved internally.
 * This typing IS the regression guard: there is no way to hand an untyped
 * string to the insert path.
 *
 * ownerSettingValue is the tolerant variant for operator settings like
 * leads.defaultLeadOwnerId, whose stored value may be either a teamMembers.id
 * (the migration seed) or a raw Clerk user id (manual repoint). A 'user_'
 * prefix means pre-resolved Clerk id; anything else resolves via
 * teamMembers.id. Always a team member.
 */
export type NotificationRecipient =
  | { clerkUserId: string; userType: NotificationUserType }
  | { teamMemberId: string }
  | { contactId: string }
  | { participantId: string; participantType: NotificationUserType }
  | { ownerSettingValue: string }

interface ResolvedRecipient {
  /** Clerk user id, the id the bell and SSE stream query by. */
  userId: string
  userType: NotificationUserType
}

export interface NotifyResult {
  /** Rows actually inserted (after identity resolution and mute filtering). */
  delivered: number
  /** Recipients dropped because they have no linked Clerk user id. */
  skipped: number
}

const NO_RESULT: NotifyResult = { delivered: 0, skipped: 0 }

type NotificationPayload = {
  type: NotificationEventType
  title: string
  body?: string | null
  entityType?: NotificationEntityType | null
  entityId?: string | null
}

/**
 * Resolve typed recipients to Clerk user ids in two batched lookups.
 * Recipients whose row is missing or has no clerkUserId count as skipped.
 * Duplicates (same Clerk user reached via different ids) collapse to one.
 */
async function resolveRecipients(
  database: DrizzleDB,
  recipients: NotificationRecipient[],
): Promise<{ resolved: ResolvedRecipient[]; skipped: number }> {
  const teamMemberIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const r of recipients) {
    if ('clerkUserId' in r) continue
    if ('teamMemberId' in r) teamMemberIds.add(r.teamMemberId)
    else if ('contactId' in r) contactIds.add(r.contactId)
    else if ('ownerSettingValue' in r) {
      if (!r.ownerSettingValue.startsWith('user_')) teamMemberIds.add(r.ownerSettingValue)
    } else if (r.participantType === 'team_member') teamMemberIds.add(r.participantId)
    else contactIds.add(r.participantId)
  }

  const [tmRows, ctRows] = await Promise.all([
    teamMemberIds.size > 0
      ? database
          .select({ id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.id, [...teamMemberIds]))
      : Promise.resolve([] as Array<{ id: string; clerkUserId: string | null }>),
    contactIds.size > 0
      ? database
          .select({ id: schema.contacts.id, clerkUserId: schema.contacts.clerkUserId })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, [...contactIds]))
      : Promise.resolve([] as Array<{ id: string; clerkUserId: string | null }>),
  ])
  const tmClerkById = new Map(tmRows.map((r) => [r.id, r.clerkUserId]))
  const ctClerkById = new Map(ctRows.map((r) => [r.id, r.clerkUserId]))

  const resolved: ResolvedRecipient[] = []
  const seen = new Set<string>()
  let skipped = 0
  const push = (userId: string | null | undefined, userType: NotificationUserType) => {
    if (!userId) {
      skipped += 1
      return
    }
    const key = `${userType}|${userId}`
    if (seen.has(key)) return
    seen.add(key)
    resolved.push({ userId, userType })
  }

  for (const r of recipients) {
    if ('clerkUserId' in r) push(r.clerkUserId, r.userType)
    else if ('teamMemberId' in r) push(tmClerkById.get(r.teamMemberId), 'team_member')
    else if ('contactId' in r) push(ctClerkById.get(r.contactId), 'contact')
    else if ('ownerSettingValue' in r)
      push(
        r.ownerSettingValue.startsWith('user_')
          ? r.ownerSettingValue
          : tmClerkById.get(r.ownerSettingValue),
        'team_member',
      )
    else if (r.participantType === 'team_member') push(tmClerkById.get(r.participantId), 'team_member')
    else push(ctClerkById.get(r.participantId), 'contact')
  }

  return { resolved, skipped }
}

/**
 * Insert multiple notification rows (one per recipient).
 * Resolves domain ids to Clerk user ids, drops muted recipients, and
 * swallows errors so a notification failure never blocks the primary action.
 */
export async function createNotifications(
  database: DrizzleDB,
  recipients: NotificationRecipient[],
  shared: NotificationPayload,
): Promise<NotifyResult> {
  if (recipients.length === 0) return NO_RESULT
  try {
    const { resolved, skipped } = await resolveRecipients(database, recipients)
    if (resolved.length === 0) return { delivered: 0, skipped }

    // Drop recipients who muted this event's in-app channel before inserting.
    const targets = await filterRecipientsByInAppPref(database, resolved, shared.type)
    if (targets.length === 0) return { delivered: 0, skipped }

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
    return { delivered: rows.length, skipped }
  } catch (err) {
    console.error('[createNotifications] failed to insert notifications:', err)
    return NO_RESULT
  }
}

interface CreateNotificationParams extends NotificationPayload {
  recipient: NotificationRecipient
}

/** Insert a single notification row. Convenience wrapper over createNotifications. */
export async function createNotification(
  database: DrizzleDB,
  params: CreateNotificationParams,
): Promise<NotifyResult> {
  const { recipient, ...shared } = params
  return createNotifications(database, [recipient], shared)
}

/**
 * Notify one Tahi team member by their teamMembers.id (e.g. a request
 * assignee). No-ops with skipped: 1 when the member has no linked Clerk login.
 */
export async function notifyTeamMember(
  database: DrizzleDB,
  teamMemberId: string,
  payload: NotificationPayload,
): Promise<NotifyResult> {
  return createNotifications(database, [{ teamMemberId }], payload)
}

/**
 * Resolve an owner-setting value (e.g. leads.defaultLeadOwnerId) to a
 * pre-resolved recipient the cron surface can reuse for dedupe queries and
 * multiple sends without re-resolving. Tolerant like the ownerSettingValue
 * recipient variant: accepts a raw Clerk user id or a teamMembers.id.
 * Returns null (never throws) when the value is empty, unknown, or the
 * member has no linked Clerk login, so call sites skip cleanly instead of
 * writing rows nobody can see.
 */
export async function resolveOwnerSetting(
  database: DrizzleDB,
  value: string | null | undefined,
): Promise<{ clerkUserId: string; userType: 'team_member' } | null> {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const { resolved } = await resolveRecipients(database, [{ ownerSettingValue: trimmed }])
    return resolved.length > 0
      ? { clerkUserId: resolved[0].userId, userType: 'team_member' }
      : null
  } catch (err) {
    console.error('[resolveOwnerSetting] failed:', err)
    return null
  }
}

/**
 * Map conversationParticipants rows to Clerk-resolved recipients ready for
 * createNotifications. Participants without a linked Clerk login are dropped,
 * as is the sender when excludeParticipantId is given. Never throws.
 */
export async function resolveParticipants(
  database: DrizzleDB,
  participants: Array<{ participantId: string; participantType: string }>,
  options?: { excludeParticipantId?: string },
): Promise<Array<{ clerkUserId: string; userType: NotificationUserType }>> {
  try {
    const rows = participants.filter(
      (p) => !options?.excludeParticipantId || p.participantId !== options.excludeParticipantId,
    )
    const { resolved } = await resolveRecipients(
      database,
      rows.map((p) => ({
        participantId: p.participantId,
        // Non-team participant types are contact rows (mirrors message
        // author enrichment in the conversation routes).
        participantType:
          p.participantType === 'team_member' ? ('team_member' as const) : ('contact' as const),
      })),
    )
    return resolved.map((r) => ({ clerkUserId: r.userId, userType: r.userType }))
  } catch (err) {
    console.error('[resolveParticipants] failed:', err)
    return []
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
        recipient: { clerkUserId: tm[0].clerkUserId, userType: 'team_member' },
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
        recipient: { clerkUserId: ct[0].clerkUserId, userType: 'contact' },
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
    const recipients: NotificationRecipient[] = members
      .filter((m): m is { clerkUserId: string } => !!m.clerkUserId)
      .map((m) => ({ clerkUserId: m.clerkUserId, userType: 'team_member' as const }))
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
    const recipients: NotificationRecipient[] = contacts
      .filter((c): c is { clerkUserId: string } => !!c.clerkUserId)
      .map((c) => ({ clerkUserId: c.clerkUserId, userType: 'contact' as const }))
    await createNotifications(database, recipients, payload)
  } catch (err) {
    console.error('[notifyOrgContacts] failed:', err)
  }
}
