import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// -- PUT /api/admin/team/[id] --
// Updates a team member's details.
export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    name?: string
    email?: string
    title?: string | null
    role?: string
    skills?: string[]
    avatarUrl?: string | null
    weeklyCapacityHours?: number | null
    isContractor?: boolean
    clerkUserId?: string | null
    department?: string | null
    reportsToId?: string | null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify team member exists
  const [existing] = await drizzle
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.email !== undefined) updates.email = body.email.trim()
  if (body.title !== undefined) updates.title = body.title?.trim() ?? null
  if (body.role !== undefined) updates.role = body.role
  if (body.skills !== undefined) updates.skills = JSON.stringify(body.skills)
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl
  if (body.weeklyCapacityHours !== undefined) updates.weeklyCapacityHours = body.weeklyCapacityHours
  if (body.isContractor !== undefined) updates.isContractor = body.isContractor
  if (body.clerkUserId !== undefined) updates.clerkUserId = body.clerkUserId
  if (body.department !== undefined) updates.department = body.department
  if (body.reportsToId !== undefined) updates.reportsToId = body.reportsToId

  await drizzle
    .update(schema.teamMembers)
    .set(updates)
    .where(eq(schema.teamMembers.id, id))

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Delete access rules first, then the team member
  const accessRules = await drizzle
    .select({ id: schema.teamMemberAccess.id })
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  for (const rule of accessRules) {
    await drizzle.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))
  }
  await drizzle.delete(schema.teamMemberAccess).where(eq(schema.teamMemberAccess.teamMemberId, id))
  await drizzle.delete(schema.teamMembers).where(eq(schema.teamMembers.id, id))

  return NextResponse.json({ success: true })
}
