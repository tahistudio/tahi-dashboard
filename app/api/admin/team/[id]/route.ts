import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// -- PUT /api/admin/team/[id] --
// Updates a team member's details.
//
// Manager-gated. This route is the only hand-writer of clerkUserId, the column
// that decides whose login maps to which roster row (and therefore which role
// and data scope), so a scoped team member must not reach it.
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'team')
  if (featureDenied) return featureDenied

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
    roles?: string[]
  }

  // Verify team member exists
  const [existing] = await drizzle
    .select({ id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId })
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
  if (body.roles !== undefined) updates.roles = JSON.stringify(body.roles)

  await drizzle
    .update(schema.teamMembers)
    .set(updates)
    .where(eq(schema.teamMembers.id, id))

  // Re-pointing a login is the single highest-impact edit on this row, so it
  // gets its own audit entry rather than being buried in a generic update.
  if (body.clerkUserId !== undefined && body.clerkUserId !== existing.clerkUserId) {
    await logAudit(drizzle as unknown as DB, {
      action: 'team_member.login_relinked',
      userId: auth.userId,
      entityType: 'team_member',
      entityId: id,
      metadata: { before: existing.clerkUserId, after: body.clerkUserId },
    })
  }

  return NextResponse.json({ success: true })
}

// -- DELETE /api/admin/team/[id] --
// Removes a team member and their access rules. Manager-gated: before this
// guard existed, any Tahi-org login could delete roster rows, including their
// own (which would silently restore the no-row default access level).
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'team')
  if (featureDenied) return featureDenied

  const { id } = await params

  const [existing] = await drizzle
    .select({ name: schema.teamMembers.name, email: schema.teamMembers.email })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.id, id))
    .limit(1)

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

  await logAudit(drizzle as unknown as DB, {
    action: 'team_member.deleted',
    userId: auth.userId,
    entityType: 'team_member',
    entityId: id,
    metadata: { name: existing?.name ?? null, email: existing?.email ?? null },
  })

  return NextResponse.json({ success: true })
}
