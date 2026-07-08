import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq, and, gte, lte, like, inArray } from 'drizzle-orm'

// ── GET /api/admin/audit ─────────────────────────────────────────────────────
// Paginated audit log with optional filters:
//   ?action=created            exact action match
//   ?actionPrefix=permission.  action prefix match (e.g. all permission changes)
//   ?userId=&entityType=&dateFrom=&dateTo=&page=
//   ?resolveNames=1            adds actorName + entityName per row (for the
//                              Team & access change history and audit viewer)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const actionPrefix = url.searchParams.get('actionPrefix')
  const userId = url.searchParams.get('userId')
  const entityType = url.searchParams.get('entityType')
  const entityId = url.searchParams.get('entityId')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const resolveNames = url.searchParams.get('resolveNames') === '1'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()

  const conditions = []
  if (action) conditions.push(eq(schema.auditLog.action, action))
  // LIKE prefix match; escape the SQL wildcard characters in the input.
  if (actionPrefix) {
    conditions.push(like(schema.auditLog.action, actionPrefix.replace(/[%_]/g, '') + '%'))
  }
  if (userId) conditions.push(eq(schema.auditLog.actorId, userId))
  if (entityType) conditions.push(eq(schema.auditLog.entityType, entityType))
  if (entityId) conditions.push(eq(schema.auditLog.entityId, entityId))
  if (dateFrom) conditions.push(gte(schema.auditLog.createdAt, dateFrom))
  if (dateTo) conditions.push(lte(schema.auditLog.createdAt, dateTo))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const items = await database
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit)
    .offset(offset)

  if (!resolveNames || items.length === 0) {
    return NextResponse.json({ items, page, limit })
  }

  // Resolve actor names (actorId is a Clerk user id) and entity names for the
  // subject types the permissions surfaces log against. One batched query per
  // table, keyed off the current page only.
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const actorIds = [...new Set(items.map((i) => i.actorId).filter((v): v is string => !!v))]
  const memberEntityIds = [
    ...new Set(
      items
        .filter((i) => i.entityType === 'team_member' && i.entityId)
        .map((i) => i.entityId as string),
    ),
  ]
  const orgEntityIds = [
    ...new Set(
      items
        .filter((i) => i.entityType === 'organisation' && i.entityId)
        .map((i) => i.entityId as string),
    ),
  ]
  const roleEntityIds = [
    ...new Set(
      items.filter((i) => i.entityType === 'role' && i.entityId).map((i) => i.entityId as string),
    ),
  ]

  const [actorRows, memberRows, orgRows, roleRows] = await Promise.all([
    actorIds.length
      ? drizzle
          .select({ clerkUserId: schema.teamMembers.clerkUserId, name: schema.teamMembers.name })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.clerkUserId, actorIds))
      : Promise.resolve([]),
    memberEntityIds.length
      ? drizzle
          .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
          .from(schema.teamMembers)
          .where(inArray(schema.teamMembers.id, memberEntityIds))
      : Promise.resolve([]),
    orgEntityIds.length
      ? drizzle
          .select({ id: schema.organisations.id, name: schema.organisations.name })
          .from(schema.organisations)
          .where(inArray(schema.organisations.id, orgEntityIds))
      : Promise.resolve([]),
    roleEntityIds.length
      ? drizzle
          .select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.roles)
          .where(inArray(schema.roles.id, roleEntityIds))
      : Promise.resolve([]),
  ])

  const actorNames = new Map(actorRows.map((r) => [r.clerkUserId, r.name]))
  const entityNames = new Map<string, string>()
  for (const r of memberRows) entityNames.set('team_member|' + r.id, r.name)
  for (const r of orgRows) entityNames.set('organisation|' + r.id, r.name)
  for (const r of roleRows) entityNames.set('role|' + r.id, r.name)

  const resolved = items.map((i) => ({
    ...i,
    actorName: (i.actorId && actorNames.get(i.actorId)) || null,
    entityName:
      (i.entityType && i.entityId && entityNames.get(i.entityType + '|' + i.entityId)) || null,
  }))

  return NextResponse.json({ items: resolved, page, limit })
}
