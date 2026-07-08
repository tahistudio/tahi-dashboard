import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/profile
 * Returns the signed-in team member's own row (matched on clerkUserId) so the
 * Settings > Profile section can edit name, title, and phone. Clerk remains the
 * source of truth for email and the login identity; this row is the workspace
 * copy shown across assignments, time entries, and the org chart.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId) || !userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const [member] = await drizzle
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      title: schema.teamMembers.title,
      phone: schema.teamMembers.phone,
      avatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  return NextResponse.json({ member: member ?? null })
}

/**
 * PATCH /api/admin/profile
 * Update the caller's own team member row. Accepts name, title, phone, and
 * avatarUrl (null clears the stored photo after a Clerk image removal). Only
 * ever writes the row matched by the caller's clerkUserId, so a team member
 * cannot edit anyone else through this route.
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId) || !userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    name?: string
    title?: string
    phone?: string
    avatarUrl?: string | null
  }

  const database = await db()
  const drizzle = database as Drizzle

  const [member] = await drizzle
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)

  if (!member) {
    return NextResponse.json({ error: 'Team member record not found' }, { status: 404 })
  }

  const updates: Record<string, string | null> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (body.title !== undefined) updates.title = typeof body.title === 'string' ? body.title.trim() : ''
  if (body.phone !== undefined) updates.phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (body.avatarUrl !== undefined) {
    updates.avatarUrl = typeof body.avatarUrl === 'string' && body.avatarUrl ? body.avatarUrl : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await drizzle
    .update(schema.teamMembers)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.teamMembers.id, member.id))

  return NextResponse.json({ success: true })
}
