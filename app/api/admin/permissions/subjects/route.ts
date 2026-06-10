import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, isNull, asc } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/permissions/subjects
// Everything the permissions builder needs to populate its pickers: team members
// (with their active roles), client orgs, and the role catalogue. Admin+ only.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied

  const [members, orgs, roles, assignments] = await Promise.all([
    drizzle
      .select({ id: schema.teamMembers.id, name: schema.teamMembers.name, email: schema.teamMembers.email })
      .from(schema.teamMembers)
      .orderBy(asc(schema.teamMembers.name)),
    drizzle
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .orderBy(asc(schema.organisations.name)),
    drizzle
      .select({ id: schema.roles.id, name: schema.roles.name, description: schema.roles.description, isSystem: schema.roles.isSystem })
      .from(schema.roles)
      .orderBy(asc(schema.roles.name)),
    drizzle
      .select({ teamMemberId: schema.teamMemberRoles.teamMemberId, roleId: schema.teamMemberRoles.roleId, roleName: schema.roles.name })
      .from(schema.teamMemberRoles)
      .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
      .where(isNull(schema.teamMemberRoles.endedAt)),
  ])

  const rolesByMember = new Map<string, Array<{ roleId: string; roleName: string }>>()
  for (const a of assignments) {
    const list = rolesByMember.get(a.teamMemberId)
    if (list) list.push({ roleId: a.roleId, roleName: a.roleName })
    else rolesByMember.set(a.teamMemberId, [{ roleId: a.roleId, roleName: a.roleName }])
  }

  return NextResponse.json({
    teamMembers: members.map(m => ({ ...m, roles: rolesByMember.get(m.id) ?? [] })),
    orgs,
    roles,
  })
}
