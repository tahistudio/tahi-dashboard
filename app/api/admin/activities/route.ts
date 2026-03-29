import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/activities
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const dealId = url.searchParams.get('dealId')
  const actOrgId = url.searchParams.get('orgId')
  const contactId = url.searchParams.get('contactId')
  const type = url.searchParams.get('type')

  const database = await db() as unknown as D1
  const conditions = []

  if (dealId) conditions.push(eq(schema.activities.dealId, dealId))
  if (actOrgId) conditions.push(eq(schema.activities.orgId, actOrgId))
  if (contactId) conditions.push(eq(schema.activities.contactId, contactId))
  if (type) conditions.push(eq(schema.activities.type, type))

  const items = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      dealId: schema.activities.dealId,
      orgId: schema.activities.orgId,
      contactId: schema.activities.contactId,
      createdById: schema.activities.createdById,
      scheduledAt: schema.activities.scheduledAt,
      completedAt: schema.activities.completedAt,
      durationMinutes: schema.activities.durationMinutes,
      outcome: schema.activities.outcome,
      createdAt: schema.activities.createdAt,
      updatedAt: schema.activities.updatedAt,
      createdByName: schema.teamMembers.name,
    })
    .from(schema.activities)
    .leftJoin(schema.teamMembers, eq(schema.activities.createdById, schema.teamMembers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.activities.createdAt))
    .limit(100)

  return NextResponse.json({ items })
}

// POST /api/admin/activities
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    type?: string
    title?: string
    description?: string
    dealId?: string
    orgId?: string
    contactId?: string
    scheduledAt?: string
    durationMinutes?: number
  }

  if (!body.type || !body.title?.trim()) {
    return NextResponse.json({ error: 'type and title are required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  // Resolve createdById: find team member ID for this Clerk user
  const [teamMember] = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  const createdById = teamMember?.id ?? userId
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.activities).values({
    id,
    type: body.type,
    title: body.title.trim(),
    description: body.description ?? null,
    dealId: body.dealId ?? null,
    orgId: body.orgId ?? null,
    contactId: body.contactId ?? null,
    createdById,
    scheduledAt: body.scheduledAt ?? null,
    durationMinutes: body.durationMinutes ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
