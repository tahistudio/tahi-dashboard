import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { featureResource } from '@/lib/permissions'
import { FEATURE_TREE } from '@/lib/feature-tree'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Display order for the seeded system roles; unknown (custom) roles follow
// alphabetically. super_admin is locked: it always has every feature.
const ROLE_ORDER = ['super_admin', 'admin', 'project_manager', 'task_handler', 'viewer']

type Effect = 'allow' | 'deny'

interface MatrixCell {
  /** The role's default for this feature (from its .view permission baseline). */
  base: Effect
  /** A role-level feature_visibility override, when one exists. */
  override: Effect | null
}

// GET /api/admin/permissions/matrix
// The effective role-by-feature grid for the Team & access roles matrix:
// every team-audience FEATURE_TREE key crossed with every role, as the
// resolver would decide it (role .view baseline, then role-level override).
// Admin+ only. Writes go through /feature-visibility (subjectType 'role').
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied

  const roles = await drizzle
    .select({ id: schema.roles.id, name: schema.roles.name, description: schema.roles.description })
    .from(schema.roles)

  roles.sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a.name)
    const ib = ROLE_ORDER.indexOf(b.name)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.name.localeCompare(b.name)
  })

  const roleIds = roles.map((r) => r.id)

  // Baseline: which resources each role can .view (mirrors resolvePermissions).
  const viewGrants = roleIds.length
    ? await drizzle
        .select({ roleId: schema.rolePermissions.roleId, resource: schema.permissions.resource })
        .from(schema.rolePermissions)
        .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
        .where(and(
          inArray(schema.rolePermissions.roleId, roleIds),
          eq(schema.permissions.action, 'view'),
        ))
    : []
  const viewableByRole = new Map<string, Set<string>>()
  for (const g of viewGrants) {
    const set = viewableByRole.get(g.roleId)
    if (set) set.add(g.resource)
    else viewableByRole.set(g.roleId, new Set([g.resource]))
  }

  // Role-level overrides.
  const overrideRows = roleIds.length
    ? await drizzle
        .select({
          subjectId: schema.featureVisibility.subjectId,
          featureKey: schema.featureVisibility.featureKey,
          effect: schema.featureVisibility.effect,
        })
        .from(schema.featureVisibility)
        .where(and(
          eq(schema.featureVisibility.subjectType, 'role'),
          inArray(schema.featureVisibility.subjectId, roleIds),
        ))
    : []
  const overrides = new Map<string, Effect>()
  for (const o of overrideRows) overrides.set(o.featureKey + '|' + o.subjectId, o.effect as Effect)

  // Every team-audience feature key, in tree order (the pane groups them).
  const featureKeys = FEATURE_TREE.filter((n) => n.appliesTo.includes('team')).map((n) => n.key)

  const cells: Record<string, Record<string, MatrixCell>> = {}
  for (const key of featureKeys) {
    const resource = featureResource(key)
    const row: Record<string, MatrixCell> = {}
    for (const role of roles) {
      const adminLevel = role.name === 'super_admin' || role.name === 'admin'
      let base: Effect = 'allow'
      if (!adminLevel && resource) {
        base = viewableByRole.get(role.id)?.has(resource) ? 'allow' : 'deny'
      }
      row[role.id] = {
        base,
        override: role.name === 'super_admin' ? null : overrides.get(key + '|' + role.id) ?? null,
      }
    }
    cells[key] = row
  }

  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      locked: r.name === 'super_admin',
    })),
    featureKeys,
    cells,
  })
}
