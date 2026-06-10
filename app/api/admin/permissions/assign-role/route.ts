import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, isNull } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// POST /api/admin/permissions/assign-role  { teamMemberId, roleId | null }
// Set a team member's level role. Ends any active role assignments first so a
// member has exactly one level role (super_admin / admin / project_manager /
// task_handler / viewer). roleId null clears the role (-> default admin level).
// Admin+ only (managers can grant any role, including super_admin, per the
// "admins can toggle everything for anyone" model).
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied

  const body = await req.json() as { teamMemberId?: string; roleId?: string | null }
  const { teamMemberId, roleId } = body
  if (!teamMemberId) {
    return NextResponse.json({ error: 'teamMemberId required' }, { status: 400 })
  }

  // Resolve the target role (validate it exists) when assigning.
  let roleName: string | null = null
  if (roleId) {
    const [role] = await drizzle
      .select({ name: schema.roles.name })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1)
    if (!role) return NextResponse.json({ error: 'Unknown roleId' }, { status: 400 })
    roleName = role.name
  }

  const now = new Date().toISOString()

  // End all currently-active role assignments for this member.
  await drizzle
    .update(schema.teamMemberRoles)
    .set({ endedAt: now })
    .where(and(
      eq(schema.teamMemberRoles.teamMemberId, teamMemberId),
      isNull(schema.teamMemberRoles.endedAt),
    ))

  // Assign the new role (if any).
  if (roleId) {
    await drizzle.insert(schema.teamMemberRoles).values({
      id: crypto.randomUUID(),
      teamMemberId,
      roleId,
      startedAt: now,
      createdAt: now,
    })
  }

  return NextResponse.json({ ok: true, roleId: roleId ?? null, roleName })
}
