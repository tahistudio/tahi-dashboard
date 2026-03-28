import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

// GET /api/admin/calls - list calls
// Query: ?orgId=xxx&status=scheduled
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterStatus = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (filterOrgId) {
    conditions.push(eq(schema.scheduledCalls.orgId, filterOrgId))
  }
  if (filterStatus) {
    conditions.push(eq(schema.scheduledCalls.status, filterStatus))
  }

  const calls = await drizzle
    .select({
      id: schema.scheduledCalls.id,
      orgId: schema.scheduledCalls.orgId,
      orgName: schema.organisations.name,
      title: schema.scheduledCalls.title,
      description: schema.scheduledCalls.description,
      scheduledAt: schema.scheduledCalls.scheduledAt,
      durationMinutes: schema.scheduledCalls.durationMinutes,
      meetingUrl: schema.scheduledCalls.meetingUrl,
      attendees: schema.scheduledCalls.attendees,
      status: schema.scheduledCalls.status,
      notes: schema.scheduledCalls.notes,
      recordingUrl: schema.scheduledCalls.recordingUrl,
      createdAt: schema.scheduledCalls.createdAt,
    })
    .from(schema.scheduledCalls)
    .leftJoin(schema.organisations, eq(schema.scheduledCalls.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schema.scheduledCalls.scheduledAt))
    .limit(limit)

  return NextResponse.json({ calls })
}

// POST /api/admin/calls - create a call
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    title?: string
    description?: string
    scheduledAt?: string
    durationMinutes?: number
    meetingUrl?: string
    attendees?: Array<{ id: string; type: string; name: string; email: string }>
  }

  if (!body.orgId?.trim()) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.scheduledAt?.trim()) {
    return NextResponse.json({ error: 'scheduledAt is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.insert(schema.scheduledCalls).values({
    id,
    orgId: body.orgId,
    title: body.title.trim(),
    description: body.description?.trim() || null,
    scheduledAt: body.scheduledAt,
    durationMinutes: body.durationMinutes ?? 30,
    meetingUrl: body.meetingUrl?.trim() || null,
    attendees: JSON.stringify(body.attendees ?? []),
    status: 'scheduled',
    createdById: userId ?? 'system',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
