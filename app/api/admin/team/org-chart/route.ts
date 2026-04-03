import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// GET /api/admin/team/org-chart
// Returns team members with reporting structure + planned roles
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const [members, planned] = await Promise.all([
    database.select().from(schema.teamMembers),
    database.select().from(schema.plannedRoles),
  ])

  // Parse roles JSON for each member
  const membersWithRoles = members.map(m => ({
    ...m,
    parsedRoles: (() => {
      try { return JSON.parse(m.roles ?? '[]') as string[] }
      catch { return [] }
    })(),
  }))

  // Build tree structure
  const roots = membersWithRoles.filter(m => !m.reportsToId)
  const plannedRoots = planned.filter(p => !p.reportsToId)

  function buildTree(parentId: string): unknown[] {
    const children = membersWithRoles.filter(m => m.reportsToId === parentId)
    const plannedChildren = planned.filter(p => p.reportsToId === parentId)
    return [
      ...children.map(c => ({
        type: 'member' as const,
        ...c,
        children: buildTree(c.id),
      })),
      ...plannedChildren.map(p => ({
        type: 'planned' as const,
        ...p,
        children: [] as unknown[],
      })),
    ]
  }

  const tree = [
    ...roots.map(r => ({
      type: 'member' as const,
      ...r,
      children: buildTree(r.id),
    })),
    ...plannedRoots.map(p => ({
      type: 'planned' as const,
      ...p,
      children: [] as unknown[],
    })),
  ]

  return NextResponse.json({
    tree,
    members: membersWithRoles,
    plannedRoles: planned,
  })
}
