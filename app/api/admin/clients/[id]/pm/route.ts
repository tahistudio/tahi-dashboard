import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/clients/[id]/pm
// Returns the assigned PM for this client.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  // Look for a team member access rule with role = 'project_manager' for this org
  const rules = await database
    .select({
      teamMemberId: schema.teamMemberAccess.teamMemberId,
    })
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.role, 'project_manager'))

  for (const rule of rules) {
    // Check via full access rule lookup
    const accessRules = await database
      .select()
      .from(schema.teamMemberAccess)
      .where(
        and(
          eq(schema.teamMemberAccess.teamMemberId, rule.teamMemberId),
          eq(schema.teamMemberAccess.role, 'project_manager')
        )
      )

    for (const ar of accessRules) {
      const orgs = await database
        .select({ orgId: schema.teamMemberAccessOrgs.orgId })
        .from(schema.teamMemberAccessOrgs)
        .where(eq(schema.teamMemberAccessOrgs.accessId, ar.id))

      if (orgs.some(o => o.orgId === id)) {
        // Found the PM
        const tm = await database
          .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.id, rule.teamMemberId))
          .limit(1)

        return NextResponse.json({
          pmId: tm.length > 0 ? tm[0].id : null,
          pmName: tm.length > 0 ? tm[0].name : null,
        })
      }
    }
  }

  return NextResponse.json({ pmId: null, pmName: null })
}

// PUT /api/admin/clients/[id]/pm
// Assigns a team member as PM for this client.
// Body: { pmId: string | null }
export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: clientOrgId } = await params
  const body = await req.json() as { pmId?: string | null }
  const { pmId } = body

  const database = await db()
  const now = new Date().toISOString()

  // Remove existing PM assignment for this org
  // Find all PM access rules
  const pmRules = await database
    .select()
    .from(schema.teamMemberAccess)
    .where(eq(schema.teamMemberAccess.role, 'project_manager'))

  for (const rule of pmRules) {
    // Check if this rule is linked to our org
    const linkedOrgs = await database
      .select()
      .from(schema.teamMemberAccessOrgs)
      .where(
        and(
          eq(schema.teamMemberAccessOrgs.accessId, rule.id),
          eq(schema.teamMemberAccessOrgs.orgId, clientOrgId)
        )
      )

    if (linkedOrgs.length > 0) {
      // Remove the org link
      await database
        .delete(schema.teamMemberAccessOrgs)
        .where(
          and(
            eq(schema.teamMemberAccessOrgs.accessId, rule.id),
            eq(schema.teamMemberAccessOrgs.orgId, clientOrgId)
          )
        )
    }
  }

  // If a new PM is being assigned, create the access rule
  if (pmId) {
    const accessId = crypto.randomUUID()
    await database.insert(schema.teamMemberAccess).values({
      id: accessId,
      teamMemberId: pmId,
      role: 'project_manager',
      scopeType: 'specific_clients',
      trackType: 'all',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(schema.teamMemberAccessOrgs).values({
      accessId,
      orgId: clientOrgId,
    })
  }

  return NextResponse.json({ success: true })
}
