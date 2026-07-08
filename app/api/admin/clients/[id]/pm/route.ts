import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray } from 'drizzle-orm'

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

  // Find the PM for this org in a single JOIN: a project_manager access rule
  // whose org link points at this client, resolved to the team member.
  const matches = await database
    .select({
      pmId: schema.teamMembers.id,
      pmName: schema.teamMembers.name,
    })
    .from(schema.teamMemberAccess)
    .innerJoin(
      schema.teamMemberAccessOrgs,
      eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id)
    )
    .innerJoin(
      schema.teamMembers,
      eq(schema.teamMembers.id, schema.teamMemberAccess.teamMemberId)
    )
    .where(
      and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, id)
      )
    )
    .limit(1)

  if (matches.length > 0) {
    return NextResponse.json({ pmId: matches[0].pmId, pmName: matches[0].pmName })
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

  // Remove any existing PM assignment for this org. Find the matching
  // org links in a single JOIN (project_manager rules linked to this org),
  // then drop them in one batched delete instead of a per-rule loop.
  const linkedRules = await database
    .select({ accessId: schema.teamMemberAccessOrgs.accessId })
    .from(schema.teamMemberAccessOrgs)
    .innerJoin(
      schema.teamMemberAccess,
      eq(schema.teamMemberAccess.id, schema.teamMemberAccessOrgs.accessId)
    )
    .where(
      and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, clientOrgId)
      )
    )

  const linkedAccessIds = [...new Set(linkedRules.map(r => r.accessId))]
  if (linkedAccessIds.length > 0) {
    await database
      .delete(schema.teamMemberAccessOrgs)
      .where(
        and(
          inArray(schema.teamMemberAccessOrgs.accessId, linkedAccessIds),
          eq(schema.teamMemberAccessOrgs.orgId, clientOrgId)
        )
      )
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
