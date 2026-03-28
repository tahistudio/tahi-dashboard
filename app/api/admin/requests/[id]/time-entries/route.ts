import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/requests/[id]/time-entries
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
    .leftJoin(schema.teamMembers, eq(schema.timeEntries.teamMemberId, schema.teamMembers.id))
    .where(eq(schema.timeEntries.requestId, requestId))
    .orderBy(desc(schema.timeEntries.date))

  return NextResponse.json({ items })
}

// POST /api/admin/requests/[id]/time-entries
// Body: { hours, description?, billable? }
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
  }

  if (typeof body.hours !== 'number' || body.hours <= 0) {
    return NextResponse.json({ error: 'hours must be a positive number' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Get the request to find the orgId
  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Find team member for the current user if not provided
  let teamMemberId = body.teamMemberId
  if (!teamMemberId && userId) {
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    teamMemberId = member?.id
  }

  if (!teamMemberId) {
    return NextResponse.json({ error: 'teamMemberId is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await drizzle.insert(schema.timeEntries).values({
    id,
    orgId: request.orgId,
    requestId,
    teamMemberId,
    hours: body.hours,
    billable: body.billable !== false,
    notes: body.description ?? null,
    date: now.split('T')[0],
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id })
}
