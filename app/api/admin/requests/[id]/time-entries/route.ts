/**
 * Time logged against one request.
 *
 * Both handlers go through lib/time-entries.ts rather than talking to the
 * table themselves, so this URL cannot drift from the other two that write
 * time (POST /api/admin/time and POST /api/admin/time-entries):
 *
 *   - the rate is resolved by the one rule (body rate wins, else the client's
 *     default_hourly_rate, else null). This route never accepted a rate at
 *     all, so every entry it wrote carried NULL and fell out of the hourly
 *     Xero export as "no rate" even for clients who have a default.
 *   - the logger is resolved to a team_members.id, never a Clerk user id.
 *   - the read join reaches historical Clerk-id rows by clerk_user_id so they
 *     stop reading "Unknown".
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import {
  createTimeEntry,
  resolveLoggingTeamMemberId,
  timeEntryFailureResponse,
  timeEntryLoggerJoin,
} from '@/lib/time-entries'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Hours logged against a request are that client's hours, so both handlers
 *  resolve the owning request's org and check the caller's scope first. */
async function guardRequestAccess(
  database: Drizzle,
  userId: string | null,
  requestId: string,
): Promise<NextResponse | null> {
  const [owner] = await database
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
  if (!owner) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return requireAccessToOrg(database, userId, owner.orgId)
}

// GET /api/admin/requests/[id]/time-entries
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardRequestAccess(drizzle, userId, requestId)
  if (denied) return denied

  const items = await drizzle
    .select({
      id: schema.timeEntries.id,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      notes: schema.timeEntries.notes,
      date: schema.timeEntries.date,
      teamMemberId: schema.timeEntries.teamMemberId,
      teamMemberName: schema.teamMembers.name,
      createdAt: schema.timeEntries.createdAt,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.teamMembers, timeEntryLoggerJoin())
    .where(eq(schema.timeEntries.requestId, requestId))
    .orderBy(desc(schema.timeEntries.date))

  return NextResponse.json({ items })
}

// POST /api/admin/requests/[id]/time-entries
// Body: { hours, description?, billable?, teamMemberId?, hourlyRate? }
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const body = await req.json() as {
    hours?: number
    description?: string
    billable?: boolean
    teamMemberId?: string
    hourlyRate?: number | null
  }

  if (typeof body.hours !== 'number' || body.hours <= 0) {
    return NextResponse.json({ error: 'hours must be a positive number' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Get the request to find the orgId
  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  // A body teamMemberId wins (the MCP tool and the service token have no
  // Clerk identity of their own); otherwise the caller's own row.
  const logger = await resolveLoggingTeamMemberId(drizzle, {
    userId,
    supplied: body.teamMemberId,
  })
  if (!logger.ok) return timeEntryFailureResponse(logger.failure)

  // The single writer stamps the rate. Entries from this URL used to carry
  // NULL whatever the client's default was, so a request's hours silently
  // dropped out of the hourly export while the same hours logged from /time
  // billed fine.
  const result = await createTimeEntry(drizzle, {
    orgId: request.orgId,
    teamMemberId: logger.teamMemberId,
    requestId,
    hours: body.hours,
    date: new Date().toISOString().slice(0, 10),
    notes: body.description ?? null,
    billable: body.billable,
    hourlyRate: body.hourlyRate,
    source: 'manual',
  })
  if (!result.ok) return timeEntryFailureResponse(result.failure)

  return NextResponse.json({ id: result.entry.id })
}
