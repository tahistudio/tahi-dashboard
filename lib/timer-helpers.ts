/**
 * Helpers for the live time tracker.
 * Pure helpers + the shared DB side-effect stopAndLogTimer, extracted out
 * of the route files so both /api/admin/timers and /api/admin/timers/[id]
 * can reuse it (Next.js forbids exporting non-route functions from route.ts).
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { INTERNAL_ORG_ID, ensureInternalOrg } from '@/lib/internal-org'
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Compute elapsed seconds on an active-timer row, accounting for pauses.
 *
 *   active  : elapsed = now - startedAt - pausedSeconds
 *   paused  : elapsed = pausedAt - startedAt - pausedSeconds
 */
export function elapsedSeconds(timer: {
  startedAt: string
  pausedAt: string | null
  pausedSeconds: number
}, now: Date = new Date()): number {
  const start = new Date(timer.startedAt).getTime()
  const end = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now.getTime()
  const elapsedMs = end - start - (timer.pausedSeconds ?? 0) * 1000
  return Math.max(0, Math.floor(elapsedMs / 1000))
}

/** Convert elapsed seconds to decimal hours (e.g. 3734s → 1.04h). */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/** Format seconds as HH:MM:SS (for live display). */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Was the last heartbeat long enough ago that we should prompt the user
 * on app reload? Default threshold is 2 minutes, configurable for tests.
 */
export function isStaleTimer(lastPingAt: string, thresholdMs = 2 * 60 * 1000, now: Date = new Date()): boolean {
  const last = new Date(lastPingAt).getTime()
  return now.getTime() - last > thresholdMs
}

export const GENERAL_KINDS = ['request', 'task', 'client'] as const
export type GeneralKind = (typeof GENERAL_KINDS)[number]

const GENERAL_LABELS: Record<GeneralKind, string> = {
  request: 'General requests time',
  task: 'General tasks time',
  client: 'General client time',
}

/** Plain-words note for a general (no client) timer, by picker kind. */
export function generalTimerNotes(kind: GeneralKind): string {
  return GENERAL_LABELS[kind]
}

/** True only when a timer points at the internal org and nothing else. */
export function isGeneralTimer(t: { requestId: string | null; taskId: string | null; orgId: string | null }): boolean {
  return !t.requestId && !t.taskId && t.orgId === INTERNAL_ORG_ID
}

/**
 * Why a stopped timer produced no time entry. Kept as codes so the API
 * response stays stable; timerLogFailureMessage turns one into words.
 */
export type TimerLogFailure = 'no_client' | 'no_team_member_row_for_user' | 'insert_failed'

const TIMER_LOG_FAILURE_MESSAGES: Record<TimerLogFailure, string> = {
  no_client: 'The hours were not logged: this timer is not attached to a request, task or client.',
  no_team_member_row_for_user: 'The hours were not logged: your login is not linked to a team member.',
  insert_failed: 'The hours were not logged: saving the time entry failed.',
}

/** Plain-words explanation for a logged:false stop. */
export function timerLogFailureMessage(reason: string | null | undefined): string {
  if (reason && reason in TIMER_LOG_FAILURE_MESSAGES) {
    return TIMER_LOG_FAILURE_MESSAGES[reason as TimerLogFailure]
  }
  return 'The hours were not logged.'
}

/**
 * Resolve which client a timer's hours belong to, from the timer's own
 * target rows. Never from the caller: passing the org in used to file the
 * previous client's hours against the next one when switching timers.
 *
 *   request timer : the request's org
 *   task timer    : the task's org, else the org of the request it hangs
 *                   off, else the hidden internal studio org (a
 *                   tahi_internal task is still studio time worth keeping)
 *   client timer  : the org already on the row
 */
export async function resolveTimerOrgId(
  drizzle: Drizzle,
  timer: { requestId: string | null; taskId: string | null; orgId: string | null },
): Promise<string | null> {
  if (timer.requestId) {
    const [r] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, timer.requestId))
      .limit(1)
    return r?.orgId ?? timer.orgId ?? null
  }

  if (timer.taskId) {
    const [t] = await drizzle
      .select({ orgId: schema.tasks.orgId, requestId: schema.tasks.requestId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, timer.taskId))
      .limit(1)
    if (t?.orgId) return t.orgId
    if (t?.requestId) {
      const [r] = await drizzle
        .select({ orgId: schema.requests.orgId })
        .from(schema.requests)
        .where(eq(schema.requests.id, t.requestId))
        .limit(1)
      if (r?.orgId) return r.orgId
    }
    if (t) return ensureInternalOrg(drizzle)
    return timer.orgId ?? null
  }

  return timer.orgId ?? null
}

/**
 * Stop an active timer and create a timeEntry row.
 * Lives here (not inside a route file) so Next.js doesn't complain about
 * non-route exports from app/api/**\/route.ts.
 *
 * Returns the derived hours + the resolved range so callers can surface
 * them to the user.
 *
 * `userId` is the Clerk user ID. timeEntries.teamMemberId has a FK to
 * team_members.id, so we resolve the Clerk ID to the team_members row
 * before inserting. If there's no matching team_members row (shouldn't
 * happen for an admin starting a timer, but we handle it anyway) we
 * skip logging, and say so in `reason` / `reasonMessage`, so the caller
 * can tell the user instead of toasting success over lost hours.
 */
export async function stopAndLogTimer(
  drizzle: Drizzle,
  timer: typeof schema.activeTimers.$inferSelect,
  userId: string,
): Promise<{
  hours: number
  startedAt: string
  endedAt: string
  logged: boolean
  reason?: string
  reasonMessage?: string
  detail?: string
}> {
  const seconds = elapsedSeconds(timer)
  // Store hours to 4 decimal places so a 10-second timer logs 0.0028h
  // instead of rounding to 0 and silently disappearing. The UI can round
  // for display; the DB keeps the truth.
  const hours = Math.round((seconds / 3600) * 10000) / 10000

  // Resolve Clerk userId → team_members.id (FK target for teamMemberId).
  const [member] = await drizzle
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)
  const teamMemberId = member?.id ?? null

  // Derive orgId for the timeEntry from the timer's own target rows.
  const orgId = await resolveTimerOrgId(drizzle, timer)

  const startedAt = timer.startedAt
  const endedAt = new Date().toISOString()
  const date = startedAt.slice(0, 10) // YYYY-MM-DD

  let logged = false
  let reason: TimerLogFailure | undefined
  let detail: string | undefined
  if (!orgId) {
    reason = 'no_client'
  } else if (!teamMemberId) {
    reason = 'no_team_member_row_for_user'
  } else {
    try {
      await drizzle.insert(schema.timeEntries).values({
        id: crypto.randomUUID(),
        orgId,
        requestId: timer.requestId ?? null,
        taskId: timer.taskId ?? null,
        teamMemberId,
        hours,
        billable: true,
        notes: timer.notes ?? null,
        date,
        startedAt,
        endedAt,
        source: 'live_timer',
      })
      logged = true
    } catch (err) {
      reason = 'insert_failed'
      detail = err instanceof Error ? err.message : String(err)
    }
  }

  // Delete the active timer row regardless of whether we could log, so
  // the user isn't stuck with a zombie timer after a schema issue.
  await drizzle.delete(schema.activeTimers).where(eq(schema.activeTimers.id, timer.id))

  return {
    hours,
    startedAt,
    endedAt,
    logged,
    reason,
    reasonMessage: logged ? undefined : timerLogFailureMessage(reason),
    detail,
  }
}
