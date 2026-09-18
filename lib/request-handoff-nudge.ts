/**
 * lib/request-handoff-nudge.ts
 *
 * The reminder a client gets when a request has been sitting with them.
 *
 * A step of the existing delivery-watch cron rather than a cron of its own,
 * because it is the same question that job already asks once a day: what is
 * not moving, and who needs telling. A hand-off nobody has acted on is the
 * client-side half of "off track".
 *
 * It lives here rather than in the route because a route.ts may only export
 * HTTP verbs (`next build` rejects what tsc allows, see
 * feedback_route_exports), and a scheduled job whose rules cannot be unit
 * tested is a job that quietly mails a client seven times.
 *
 * THE TWO NUMBERS, and why they are separate:
 *
 *   handoffNudgeDays  how long a hand-off sits before the FIRST reminder.
 *                     Studio-settable, default 3.
 *   MIN_DAYS_BETWEEN  the floor between any two reminders, whatever that
 *                     setting says. Lowering the setting to 1 should mean
 *                     "chase sooner", never "mail this person every morning
 *                     until they cave".
 *
 * Once per three days is enforced by `waiting_nudged_at` on the request row
 * rather than by scanning notifications: the stamp survives a notification
 * being read, deleted, or never inserted at all, and a contact with no Clerk
 * login has no bell row to scan. Those are exactly the people this chases.
 */

import { schema } from '@/db/d1'
import { and, eq, isNotNull, lte, or, sql } from 'drizzle-orm'
import { createNotifications } from '@/lib/notifications'
import { notificationEmailUrl, waitingOnYouEmailPlan } from '@/lib/notification-email'
import {
  HANDOFF_ACTION_VERB,
  HANDOFF_REASON_SENTENCE,
  daysWaiting,
  isHandoffReason,
} from '@/lib/request-handoff'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The setting the studio can move. */
export const HANDOFF_NUDGE_DAYS_SETTING = 'requests.handoffNudgeDays'

/** How long a hand-off sits before the first reminder, absent a setting. */
export const DEFAULT_NUDGE_AFTER_DAYS = 3

/** The floor between two reminders for the same hand-off. Not settable. */
export const MIN_DAYS_BETWEEN_NUDGES = 3

/** Most hand-offs to chase in one run. Far past any real backlog. */
const MAX_PER_RUN = 200

const MS_PER_DAY = 86_400_000

export interface HandoffNudgeResult {
  /** Hand-offs that were due a reminder this run. */
  scanned: number
  /** Reminders actually sent. */
  nudged: number
  /** The window in force, after the setting was read. */
  afterDays: number
}

/**
 * Read `requests.handoffNudgeDays`, tolerantly. A missing row, an unreadable
 * settings table, or a value somebody typed by hand all fall back to the
 * default rather than disabling the chase: "nobody gets reminded" is a much
 * worse failure than "reminded on the default schedule".
 */
export async function resolveNudgeAfterDays(database: Drizzle): Promise<number> {
  try {
    const [row] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, HANDOFF_NUDGE_DAYS_SETTING))
      .limit(1)
    const parsed = Number.parseInt(row?.value ?? '', 10)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 60) return parsed
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_NUDGE_AFTER_DAYS
}

/**
 * Chase every hand-off that has gone past its window and has not been chased
 * in the last three days.
 *
 * Never throws. Returns zeroes when migration 0104 has not landed, so the
 * engagement half of delivery-watch cannot be taken down by a column that does
 * not exist yet.
 */
export async function nudgeStalledHandoffs(
  database: Drizzle,
  now: Date = new Date(),
): Promise<HandoffNudgeResult> {
  const afterDays = await resolveNudgeAfterDays(database)
  const handedOffBefore = new Date(now.getTime() - afterDays * MS_PER_DAY).toISOString()
  const nudgedBefore = new Date(now.getTime() - MIN_DAYS_BETWEEN_NUDGES * MS_PER_DAY).toISOString()

  let rows: Array<{
    id: string
    orgId: string
    title: string
    requestNumber: number | null
    waitingReason: string | null
    waitingSince: string | null
    waitingNote: string | null
    waitingDueAt: string | null
    contactId: string | null
    contactName: string | null
  }>
  try {
    rows = await database
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        requestNumber: schema.requests.requestNumber,
        waitingReason: schema.requests.waitingReason,
        waitingSince: schema.requests.waitingSince,
        waitingNote: schema.requests.waitingNote,
        waitingDueAt: schema.requests.waitingDueAt,
        contactId: schema.contacts.id,
        contactName: schema.contacts.name,
      })
      .from(schema.requests)
      // INNER join: a pointer at a contact row that has since been deleted has
      // nobody to chase, and a reminder addressed to nothing is worse than
      // none. The studio still sees the chip.
      .innerJoin(schema.contacts, eq(schema.requests.waitingOnContactId, schema.contacts.id))
      .where(and(
        isNotNull(schema.requests.waitingOnContactId),
        // A pointer with no stamp cannot be shown to be overdue, so it is
        // skipped rather than chased.
        isNotNull(schema.requests.waitingSince),
        lte(schema.requests.waitingSince, handedOffBefore),
        or(
          sql`${schema.requests.waitingNudgedAt} IS NULL`,
          lte(schema.requests.waitingNudgedAt, nudgedBefore),
        ),
      ))
      .limit(MAX_PER_RUN)
  } catch {
    return { scanned: 0, nudged: 0, afterDays }
  }

  let nudged = 0
  for (const row of rows) {
    if (!row.contactId) continue
    try {
      const reason = isHandoffReason(row.waitingReason) ? row.waitingReason : 'other'

      // The stamp goes down FIRST. A send that throws after the stamp costs
      // one reminder; a stamp that never landed because the send threw would
      // let tomorrow's run mail the same person again, which is the exact
      // failure this whole step exists to prevent.
      await database
        .update(schema.requests)
        .set({ waitingNudgedAt: now.toISOString() })
        .where(eq(schema.requests.id, row.id))

      const days = daysWaiting(row.waitingSince, now)
      const reasonLabel = HANDOFF_REASON_SENTENCE[reason]

      await createNotifications(database, [{ contactId: row.contactId }], {
        type: 'request_waiting_on_you',
        title: `Still with you: "${row.title}"`,
        body: `${reasonLabel}. It has been ${days} day${days === 1 ? '' : 's'}.`,
        entityType: 'request',
        entityId: row.id,
        email: waitingOnYouEmailPlan({
          requestId: row.id,
          requestTitle: row.title,
          requestNumber: row.requestNumber,
          orgId: row.orgId,
          reasonLabel,
          actionVerb: HANDOFF_ACTION_VERB[reason],
          // The studio, not a person: the member who handed it over three days
          // ago is not necessarily the one who will pick the answer up.
          fromName: 'Tahi Studio',
          note: row.waitingNote,
          dueAt: row.waitingDueAt,
          actionUrl: notificationEmailUrl(row.id, 'client'),
          isNudge: true,
        }),
      })
      nudged += 1
    } catch (err) {
      // One unreachable client never stops the rest of the run.
      console.warn(`[handoff-nudge] could not chase request ${row.id}:`, err)
    }
  }

  return { scanned: rows.length, nudged, afterDays }
}
