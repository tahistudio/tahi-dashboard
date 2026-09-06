/**
 * lib/time-entries.ts
 *
 * The one place a time entry is validated and written.
 *
 * There are two admin URLs that create time entries by hand and they had
 * drifted apart:
 *
 *   POST /api/admin/time          the Log time slide-over on /time. It read
 *                                 orgId / teamMemberId / hours / notes /
 *                                 billable / date off the body and NOTHING
 *                                 else, so the "Rate ($/hr)" field the form
 *                                 has always shown was typed, posted, and
 *                                 dropped on the floor. Every entry logged
 *                                 from that page carries a NULL rate.
 *
 *   POST /api/admin/time-entries  the time card on a request / task. This one
 *                                 did persist body.hourlyRate.
 *
 * Both now go through `createTimeEntry` below, so a rate typed into either
 * one lands in the same column, and any field added to `time_entries` later
 * has a single writer to teach rather than two to keep in step.
 *
 * RATE RESOLUTION (the rule, stated once):
 *
 *   1. A rate on the body wins. It is what the person typed.
 *   2. Otherwise fall back to `organisations.default_hourly_rate` for the
 *      client the hours belong to, when that is set and above zero.
 *   3. Otherwise NULL, which reads as "no rate" and is honest.
 *
 * Never 0. A zero rate is indistinguishable from free work once it is in the
 * column, and an invoice built off it silently bills nothing.
 *
 * The resolved rate is PERSISTED ON THE ROW rather than looked up at invoice
 * time on purpose: a client's default rate is a moving number, and hours
 * logged last quarter must keep the rate they were logged at.
 *
 * This module is deliberately free of auth and org resolution. Callers have
 * already decided WHICH org the hours belong to and whether the caller may
 * reach it (`requireAccessToOrg`); this module only decides what gets stored.
 */

import { NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { eq, or, type SQL } from 'drizzle-orm'
import { resolveTeamMember } from '@/lib/team-identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How the entry came to exist. Mirrors `time_entries.source`. */
export type TimeEntrySource = 'manual' | 'live_timer' | 'imported'

/**
 * Everything a caller may hand over. `orgId` and `teamMemberId` are already
 * resolved: neither is derived here, because each route finds them a
 * different way (a body field on /api/admin/time, the target row's owner on
 * /api/admin/time-entries).
 */
export interface TimeEntryDraft {
  orgId: string | null | undefined
  teamMemberId: string | null | undefined
  hours: number | null | undefined
  date: string | null | undefined
  requestId?: string | null
  taskId?: string | null
  notes?: string | null
  billable?: boolean
  /** Undefined or null both mean "not given", which triggers the org fallback. */
  hourlyRate?: number | null
  startedAt?: string | null
  endedAt?: string | null
  source?: TimeEntrySource
}

/** A refusal, in the shape both routes already return. */
export interface TimeEntryFailure {
  status: 400
  error: string
}

/** What was actually written, so a route can echo it back. */
export interface PersistedTimeEntry {
  id: string
  orgId: string
  teamMemberId: string
  hours: number
  date: string
  hourlyRate: number | null
  billable: boolean
}

export type CreateTimeEntryResult =
  | { ok: true; entry: PersistedTimeEntry }
  | { ok: false; failure: TimeEntryFailure }

/**
 * Field checks, split out so a route can run them BEFORE it touches the
 * database. `/api/admin/time` needs that: without it a body missing `orgId`
 * would reach the org access gate with nothing to gate on and come back 404
 * "Not found" instead of 400 "orgId is required".
 *
 * Returns null when the draft is fit to persist.
 */
export function validateTimeEntryDraft(draft: TimeEntryDraft): TimeEntryFailure | null {
  if (!draft.orgId) {
    return { status: 400, error: 'orgId is required' }
  }
  if (!draft.teamMemberId) {
    return { status: 400, error: 'teamMemberId is required' }
  }
  if (typeof draft.hours !== 'number' || !Number.isFinite(draft.hours) || draft.hours <= 0) {
    return { status: 400, error: 'hours must be a positive number' }
  }
  if (!draft.date) {
    return { status: 400, error: 'date is required' }
  }
  // Only a rate that was actually supplied is checked. Absent is legal and
  // means "use the client default", which is a different branch entirely.
  if (draft.hourlyRate !== undefined && draft.hourlyRate !== null) {
    if (typeof draft.hourlyRate !== 'number' || !Number.isFinite(draft.hourlyRate) || draft.hourlyRate < 0) {
      return { status: 400, error: 'hourlyRate must be a number of 0 or more' }
    }
  }
  return null
}

/** Turn a refusal into the JSON response both routes return. */
export function timeEntryFailureResponse(failure: TimeEntryFailure): NextResponse {
  return NextResponse.json({ error: failure.error }, { status: failure.status })
}

/**
 * Decide the rate to store. See the rule at the top of this file.
 *
 * A supplied rate is taken as given, including an explicit 0: the caller
 * asked for it, so nothing is silent about it. Only the FALLBACK refuses to
 * produce a 0, because a client whose `default_hourly_rate` is unset or zero
 * has no rate rather than a free one.
 */
export async function resolveHourlyRate(
  drizzle: Drizzle,
  orgId: string,
  supplied: number | null | undefined,
): Promise<number | null> {
  if (typeof supplied === 'number' && Number.isFinite(supplied) && supplied >= 0) {
    return supplied
  }

  // The client default is the only fallback. A studio-wide default would be a
  // second moving number to reconcile, and nobody has asked for one.
  try {
    const [org] = await drizzle
      .select({ defaultHourlyRate: schema.organisations.defaultHourlyRate })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
    const fallback = org?.defaultHourlyRate
    if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) {
      return fallback
    }
  } catch (err) {
    // A rate we could not read is not a reason to lose the hours. Log it and
    // store no rate, which is what the row would have carried anyway.
    console.error('[time-entries] failed to read default hourly rate', err)
  }

  return null
}

/**
 * Validate, resolve the rate, and insert. The single writer for manual time.
 *
 * Timestamps are set explicitly rather than left to the column defaults so
 * both routes stamp the same format (the SQL default drops milliseconds).
 */
export async function createTimeEntry(
  drizzle: Drizzle,
  draft: TimeEntryDraft,
): Promise<CreateTimeEntryResult> {
  const invalid = validateTimeEntryDraft(draft)
  if (invalid) return { ok: false, failure: invalid }

  // Narrowed by validateTimeEntryDraft, which the compiler cannot see across
  // the call boundary.
  const orgId = draft.orgId as string
  const teamMemberId = draft.teamMemberId as string
  const hours = draft.hours as number
  const date = draft.date as string

  const hourlyRate = await resolveHourlyRate(drizzle, orgId, draft.hourlyRate)
  const billable = draft.billable !== false
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await drizzle.insert(schema.timeEntries).values({
    id,
    orgId,
    requestId: draft.requestId ?? null,
    taskId: draft.taskId ?? null,
    teamMemberId,
    hours,
    hourlyRate,
    billable,
    notes: draft.notes ?? null,
    date,
    startedAt: draft.startedAt ?? null,
    endedAt: draft.endedAt ?? null,
    source: draft.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  })

  return {
    ok: true,
    entry: { id, orgId, teamMemberId, hours, date, hourlyRate, billable },
  }
}

/**
 * Derive hours + date from the three shapes `/api/admin/time-entries`
 * accepts: scalar (hours), range (startedAt + endedAt), and mixed (both, in
 * which case the explicit hours win and the range is kept for reference).
 *
 * Lives here so `/api/admin/time` can grow range support later without a
 * second copy of the arithmetic.
 */
export function deriveHoursAndDate(input: {
  hours?: number
  startedAt?: string | null
  endedAt?: string | null
  date?: string | null
}): { hours: number; date: string } | TimeEntryFailure {
  let hours = input.hours
  const startedAt = input.startedAt ?? null
  const endedAt = input.endedAt ?? null

  if (hours === undefined && startedAt && endedAt) {
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
    if (!Number.isFinite(ms) || ms <= 0) {
      return { status: 400, error: 'Invalid range : endedAt must be after startedAt' }
    }
    hours = Math.round((ms / 3600000) * 100) / 100
  }
  if (!hours || hours <= 0) {
    return { status: 400, error: 'hours (or a valid startedAt + endedAt range) required' }
  }

  const date = input.date ?? (startedAt ? startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
  return { hours, date }
}

/** Narrow a `deriveHoursAndDate` return. */
export function isTimeEntryFailure(
  value: { hours: number; date: string } | TimeEntryFailure,
): value is TimeEntryFailure {
  return 'error' in value
}

/**
 * WHO LOGGED THE HOURS (the write side).
 *
 * `time_entries.team_member_id` has a foreign key to `team_members.id`, and
 * the value an API route has in its hand is a CLERK user id. POST
 * /api/admin/time-entries used to pass the Clerk id straight through, so every
 * entry logged from the time card on a request or task joined to no member row
 * and read as "Unknown" on /time. The live timer had always resolved it first
 * (lib/timer-helpers.ts), which is why the same hours logged two ways came out
 * owned by two different people.
 *
 * The resolution, in order:
 *
 *   1. An explicit `teamMemberId` that IS a `team_members.id` is kept. A
 *      caller who names a member (the MCP tools, an admin logging on someone
 *      else's behalf) has already decided.
 *   2. An explicit id that turns out to be a Clerk id is resolved rather than
 *      refused: it is the very mistake this function exists to stop, and the
 *      person it names is unambiguous.
 *   3. Otherwise the caller's own Clerk id, through `resolveTeamMember`, the
 *      one place `team_members.clerk_user_id` is read.
 *
 * A failure is a 400, never a write. An entry pointing at nobody is worse than
 * a refused one: the hours still count toward a client's burn, but no report
 * can attribute them and the person who logged them has no way to notice.
 */
export async function resolveLoggingTeamMemberId(
  drizzle: Drizzle,
  input: { userId?: string | null; supplied?: string | null },
): Promise<{ ok: true; teamMemberId: string } | { ok: false; failure: TimeEntryFailure }> {
  const supplied = typeof input.supplied === 'string' ? input.supplied.trim() : ''

  if (supplied) {
    const [byId] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, supplied))
      .limit(1)
    if (byId?.id) return { ok: true, teamMemberId: byId.id }

    const [byClerkId] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, supplied))
      .limit(1)
    if (byClerkId?.id) return { ok: true, teamMemberId: byClerkId.id }

    return {
      ok: false,
      failure: { status: 400, error: 'teamMemberId does not match a team member' },
    }
  }

  const member = await resolveTeamMember(drizzle, input.userId ?? null)
  if (member) return { ok: true, teamMemberId: member.id }

  return {
    ok: false,
    failure: {
      status: 400,
      error: 'Your login is not linked to a team member, so the hours were not logged. Link the account on the Team page, or send an explicit teamMemberId.',
    },
  }
}

/**
 * WHO LOGGED THE HOURS (the read side).
 *
 * The join condition every surface that names the logger uses, in one place so
 * the fallback cannot end up half applied.
 *
 * Rows written before `resolveLoggingTeamMemberId` existed carry a Clerk user
 * id in `team_member_id`. They are NOT rewritten: a backfill would be guessing
 * at ids on a billing input. The join reaches them through
 * `team_members.clerk_user_id` instead, so history stops reading "Unknown"
 * without a migration touching a single row.
 *
 * Matching both columns is safe because they cannot collide: an id is a UUID
 * this app mints, a Clerk user id is a `user_...` string Clerk mints.
 */
export function timeEntryLoggerJoin(): SQL | undefined {
  return or(
    eq(schema.timeEntries.teamMemberId, schema.teamMembers.id),
    eq(schema.timeEntries.teamMemberId, schema.teamMembers.clerkUserId),
  )
}
