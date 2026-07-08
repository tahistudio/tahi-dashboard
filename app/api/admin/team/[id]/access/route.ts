import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'

// -- GET /api/admin/team/[id]/access --
// Returns access rules for a specific team member.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  // Get access rules
  const rules = await database
    .select()
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  // For each rule with scopeType = 'specific_clients', get the org IDs
  const rulesWithOrgs = await Promise.all(
    rules.map(async (rule) => {
      if (rule.scopeType === 'specific_clients') {
        const orgRows = await database
          .select({ orgId: schema.teamMemberAccessOrgs.orgId })
          .from(schema.teamMemberAccessOrgs)
          .where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))

        return {
          ...rule,
          orgIds: orgRows.map((r) => r.orgId),
        }
      }
      return { ...rule, orgIds: [] as string[] }
    })
  )

  return NextResponse.json({ rules: rulesWithOrgs })
}

// -- PUT /api/admin/team/[id]/access --
// Replaces access rules for a specific team member.
// Body: { role, scopeType, planType?, trackType?, orgIds?: string[] }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Data scope IS a permission change: same feature gate as the builder, so an
  // admin denied the permissions surface cannot widen scope through this route.
  const featureDenied = await requireFeature(auth, 'settings.permissions')
  if (featureDenied) return featureDenied

  const { id } = await params

  const body = await req.json() as {
    role?: string
    scopeType?: string
    planType?: string
    trackType?: string
    orgIds?: string[]
  }

  if (!body.role || !['project_manager', 'task_handler', 'viewer'].includes(body.role)) {
    return NextResponse.json(
      { error: 'role must be one of: project_manager, task_handler, viewer' },
      { status: 400 }
    )
  }
  if (!body.scopeType || !['all_clients', 'plan_type', 'specific_clients'].includes(body.scopeType)) {
    return NextResponse.json(
      { error: 'scopeType must be one of: all_clients, plan_type, specific_clients' },
      { status: 400 }
    )
  }

  const database = await db()
  const now = new Date().toISOString()

  // Snapshot the current rule (before) for the audit trail, then delete.
  const existingRules = await database
    .select()
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  let beforeOrgIds: string[] = []
  for (const rule of existingRules) {
    if (rule.scopeType === 'specific_clients') {
      const rows = await database
        .select({ orgId: schema.teamMemberAccessOrgs.orgId })
        .from(schema.teamMemberAccessOrgs)
        .where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))
      beforeOrgIds = rows.map((r) => r.orgId)
    }
    await database
      .delete(schema.teamMemberAccessOrgs)
      .where(eq(schema.teamMemberAccessOrgs.accessId, rule.id))
  }

  await database
    .delete(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  // Create new access rule
  const accessId = crypto.randomUUID()
  await database.insert(schema.teamMemberAccess).values({
    id: accessId,
    teamMemberId: id,
    role: body.role,
    scopeType: body.scopeType,
    planType: body.planType ?? null,
    trackType: body.trackType ?? 'all',
    createdAt: now,
    updatedAt: now,
  })

  // If specific_clients, add org links
  if (body.scopeType === 'specific_clients' && body.orgIds && body.orgIds.length > 0) {
    for (const oid of body.orgIds) {
      await database.insert(schema.teamMemberAccessOrgs).values({
        accessId,
        orgId: oid,
      })
    }
  }

  const prev = existingRules[0]
  await logAudit(database as unknown as DB, {
    action: 'permission.scope_changed',
    userId: auth.userId,
    entityType: 'team_member',
    entityId: id,
    metadata: {
      before: prev
        ? {
            scopeType: prev.scopeType,
            planType: prev.planType,
            trackType: prev.trackType,
            orgIds: beforeOrgIds,
          }
        : null,
      after: {
        scopeType: body.scopeType,
        planType: body.planType ?? null,
        trackType: body.trackType ?? 'all',
        orgIds: body.scopeType === 'specific_clients' ? body.orgIds ?? [] : [],
      },
    },
  })

  return NextResponse.json({ success: true })
}
