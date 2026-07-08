import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and, isNull } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface CopyBody {
  subjectType?: 'team_member' | 'organisation'
  sourceId?: string
  targetId?: string
}

// POST /api/admin/permissions/copy-access
// Replace the target subject's access with a copy of the source subject's.
// Team members: level role + feature overrides + data scope rule.
// Organisations: feature overrides (that is all client access consists of).
// Admin+ only, gated on the permissions builder feature, audit logged.
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'settings.permissions')
  if (featureDenied) return featureDenied

  const body = (await req.json()) as CopyBody
  const { subjectType, sourceId, targetId } = body
  if (!subjectType || !sourceId || !targetId || sourceId === targetId) {
    return NextResponse.json(
      { error: 'subjectType, sourceId, targetId (distinct) required' },
      { status: 400 },
    )
  }
  if (subjectType !== 'team_member' && subjectType !== 'organisation') {
    return NextResponse.json({ error: 'subjectType must be team_member | organisation' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Validate both subjects exist (and get names for the audit line).
  const table = subjectType === 'team_member' ? schema.teamMembers : schema.organisations
  const [source] = await drizzle
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.id, sourceId))
    .limit(1)
  const [target] = await drizzle
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.id, targetId))
    .limit(1)
  if (!source || !target) {
    return NextResponse.json({ error: 'Unknown source or target subject' }, { status: 404 })
  }

  // ── Feature overrides: replace target's with a copy of source's ──
  const sourceOverrides = await drizzle
    .select({
      featureKey: schema.featureVisibility.featureKey,
      effect: schema.featureVisibility.effect,
      reason: schema.featureVisibility.reason,
    })
    .from(schema.featureVisibility)
    .where(and(
      eq(schema.featureVisibility.subjectType, subjectType),
      eq(schema.featureVisibility.subjectId, sourceId),
    ))

  await drizzle.delete(schema.featureVisibility).where(and(
    eq(schema.featureVisibility.subjectType, subjectType),
    eq(schema.featureVisibility.subjectId, targetId),
  ))
  for (const o of sourceOverrides) {
    await drizzle.insert(schema.featureVisibility).values({
      id: crypto.randomUUID(),
      subjectType,
      subjectId: targetId,
      featureKey: o.featureKey,
      effect: o.effect,
      reason: o.reason,
      createdById: auth.userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  let copiedRoleName: string | null = null
  let copiedScopeType: string | null = null

  if (subjectType === 'team_member') {
    // ── Level role: end target's active assignments, mirror source's ──
    const [sourceRole] = await drizzle
      .select({ roleId: schema.teamMemberRoles.roleId, roleName: schema.roles.name })
      .from(schema.teamMemberRoles)
      .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
      .where(and(
        eq(schema.teamMemberRoles.teamMemberId, sourceId),
        isNull(schema.teamMemberRoles.endedAt),
      ))
      .limit(1)

    await drizzle
      .update(schema.teamMemberRoles)
      .set({ endedAt: now })
      .where(and(
        eq(schema.teamMemberRoles.teamMemberId, targetId),
        isNull(schema.teamMemberRoles.endedAt),
      ))

    if (sourceRole) {
      copiedRoleName = sourceRole.roleName
      await drizzle.insert(schema.teamMemberRoles).values({
        id: crypto.randomUUID(),
        teamMemberId: targetId,
        roleId: sourceRole.roleId,
        startedAt: now,
        createdAt: now,
      })
      // Keep the legacy column in lockstep (same rule as assign-role): admin
      // parity for admin-level roles, 'member' for every scoped role, so
      // access-scoping can never hand a scoped member unrestricted access.
      const legacyRole =
        sourceRole.roleName === 'super_admin' || sourceRole.roleName === 'admin' ? 'admin' : 'member'
      await drizzle
        .update(schema.teamMembers)
        .set({ role: legacyRole })
        .where(eq(schema.teamMembers.id, targetId))
    }

    // ── Data scope: replace target's rule with a copy of source's ──
    const sourceRules = await drizzle
      .select()
      .from(schema.teamMemberAccess)
      .where(eq(schema.teamMemberAccess.teamMemberId, sourceId))

    const targetRules = await drizzle
      .select({ id: schema.teamMemberAccess.id })
      .from(schema.teamMemberAccess)
      .where(eq(schema.teamMemberAccess.teamMemberId, targetId))
    for (const r of targetRules) {
      await drizzle.delete(schema.teamMemberAccessOrgs).where(eq(schema.teamMemberAccessOrgs.accessId, r.id))
      await drizzle.delete(schema.teamMemberAccess).where(eq(schema.teamMemberAccess.id, r.id))
    }

    for (const rule of sourceRules) {
      copiedScopeType = rule.scopeType
      const newId = crypto.randomUUID()
      await drizzle.insert(schema.teamMemberAccess).values({
        id: newId,
        teamMemberId: targetId,
        role: rule.role,
        scopeType: rule.scopeType,
        planType: rule.planType,
        trackType: rule.trackType,
        createdAt: now,
        updatedAt: now,
      })
      if (rule.scopeType === 'specific_clients') {
        const orgRows = await drizzle
          .select({ orgId: schema.teamMemberAccessOrgs.orgId })
          .from(schema.teamMemberAccessOrgs)
          .where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))
        for (const o of orgRows) {
          await drizzle.insert(schema.teamMemberAccessOrgs).values({ accessId: newId, orgId: o.orgId })
        }
      }
    }
  }

  await logAudit(drizzle as unknown as DB, {
    action: 'permission.access_copied',
    userId: auth.userId,
    entityType: subjectType,
    entityId: targetId,
    metadata: {
      sourceId,
      sourceName: source.name,
      targetName: target.name,
      overridesCopied: sourceOverrides.length,
      roleCopied: copiedRoleName,
      scopeCopied: copiedScopeType,
    },
  })

  return NextResponse.json({
    ok: true,
    overridesCopied: sourceOverrides.length,
    roleCopied: copiedRoleName,
    scopeCopied: copiedScopeType,
  })
}
