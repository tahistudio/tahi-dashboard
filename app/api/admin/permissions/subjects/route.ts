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

  const [members, orgs, roles, assignments, accessRules, accessOrgs, contacts] = await Promise.all([
    drizzle
      .select({ id: schema.teamMembers.id, name: schema.teamMembers.name, email: schema.teamMembers.email })
      .from(schema.teamMembers)
      .orderBy(asc(schema.teamMembers.name)),
    drizzle
      .select({ id: schema.organisations.id, name: schema.organisations.name, planType: schema.organisations.planType })
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
    drizzle
      .select({
        id: schema.teamMemberAccess.id,
        teamMemberId: schema.teamMemberAccess.teamMemberId,
        scopeType: schema.teamMemberAccess.scopeType,
        planType: schema.teamMemberAccess.planType,
        trackType: schema.teamMemberAccess.trackType,
      })
      .from(schema.teamMemberAccess),
    drizzle
      .select({ accessId: schema.teamMemberAccessOrgs.accessId, orgId: schema.teamMemberAccessOrgs.orgId })
      .from(schema.teamMemberAccessOrgs),
    drizzle
      .select({
        id: schema.contacts.id,
        orgId: schema.contacts.orgId,
        name: schema.contacts.name,
        email: schema.contacts.email,
        title: schema.contacts.role,
        portalRole: schema.contacts.portalRole,
        isPrimary: schema.contacts.isPrimary,
        clerkUserId: schema.contacts.clerkUserId,
      })
      .from(schema.contacts)
      .orderBy(asc(schema.contacts.name)),
  ])

  const rolesByMember = new Map<string, Array<{ roleId: string; roleName: string }>>()
  for (const a of assignments) {
    const list = rolesByMember.get(a.teamMemberId)
    if (list) list.push({ roleId: a.roleId, roleName: a.roleName })
    else rolesByMember.set(a.teamMemberId, [{ roleId: a.roleId, roleName: a.roleName }])
  }

  // Data-scope rule per member (one rule per member in practice; the PUT
  // replaces). orgIds only populate for specific_clients rules.
  const orgIdsByAccess = new Map<string, string[]>()
  for (const ao of accessOrgs) {
    const list = orgIdsByAccess.get(ao.accessId)
    if (list) list.push(ao.orgId)
    else orgIdsByAccess.set(ao.accessId, [ao.orgId])
  }
  const scopeByMember = new Map<
    string,
    { scopeType: string; planType: string | null; trackType: string; orgIds: string[] }
  >()
  for (const rule of accessRules) {
    scopeByMember.set(rule.teamMemberId, {
      scopeType: rule.scopeType,
      planType: rule.planType,
      trackType: rule.trackType,
      orgIds: orgIdsByAccess.get(rule.id) ?? [],
    })
  }

  // People per org: the contacts (client-portal users) at each client. A
  // contact with no clerkUserId is a pending invite - they cannot resolve a
  // session yet, so their per-person overrides only bite once they log in.
  const contactsByOrg = new Map<
    string,
    Array<{
      id: string
      name: string
      email: string
      title: string | null
      portalRole: string
      isPrimary: boolean
      pending: boolean
    }>
  >()
  for (const c of contacts) {
    const entry = {
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title ?? null,
      portalRole: c.portalRole,
      isPrimary: !!c.isPrimary,
      pending: !c.clerkUserId,
    }
    const list = contactsByOrg.get(c.orgId)
    if (list) list.push(entry)
    else contactsByOrg.set(c.orgId, [entry])
  }

  return NextResponse.json({
    teamMembers: members.map(m => ({
      ...m,
      roles: rolesByMember.get(m.id) ?? [],
      scope: scopeByMember.get(m.id) ?? null,
    })),
    orgs: orgs.map(o => ({ ...o, contacts: contactsByOrg.get(o.id) ?? [] })),
    roles,
  })
}
