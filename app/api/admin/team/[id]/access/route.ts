import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // Delete existing access rules for this team member
  const existingRules = await database
    .select({ id: schema.teamMemberAccess.id })
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.teamMemberId, id))

  for (const rule of existingRules) {
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

  return NextResponse.json({ success: true })
}
