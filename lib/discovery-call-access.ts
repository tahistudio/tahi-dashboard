import { NextResponse } from 'next/server'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { scopedOrgIds, type OrgScope } from '@/lib/access-scope'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { orgLiteralInScope as orgColumnInScope } from '@/lib/route-org-filter'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

/** A call can carry several parents. Every client link must be permitted. */
export function discoveryCallScopeCondition(scope: OrgScope) {
  if (scope.kind === 'all') return undefined
  if (scope.kind === 'none') return sql`0 = 1`
  const orgs = scope.orgIds
  return and(
    orgColumnInScope(schema.discoveryCalls.orgId, orgs, { includeNull: true }),
    or(isNull(schema.discoveryCalls.dealId), sql`${schema.discoveryCalls.dealId} IN (
      SELECT ${schema.deals.id} FROM ${schema.deals}
      WHERE ${orgColumnInScope(schema.deals.orgId, orgs, { includeNull: true })}
    )`),
    or(isNull(schema.discoveryCalls.requestId), sql`${schema.discoveryCalls.requestId} IN (
      SELECT ${schema.requests.id} FROM ${schema.requests}
      WHERE ${orgColumnInScope(schema.requests.orgId, orgs)}
    )`),
    or(isNull(schema.discoveryCalls.taskId), sql`${schema.discoveryCalls.taskId} IN (
      SELECT ${schema.tasks.id} FROM ${schema.tasks}
      WHERE ${orgColumnInScope(schema.tasks.orgId, orgs, { includeNull: true })}
    )`),
  )
}

export async function requireDiscoveryCallAccess(database: Database, auth: Auth, id: string) {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  if (scope.kind === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [call] = await database.select({
    id: schema.discoveryCalls.id, orgId: schema.discoveryCalls.orgId,
    dealId: schema.discoveryCalls.dealId, requestId: schema.discoveryCalls.requestId,
    taskId: schema.discoveryCalls.taskId,
  }).from(schema.discoveryCalls).where(and(
    eq(schema.discoveryCalls.id, id), discoveryCallScopeCondition(scope),
  )).limit(1)
  if (!call) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return requireAccessToOrgOrPreClient(database, auth.userId, call.orgId)
}
