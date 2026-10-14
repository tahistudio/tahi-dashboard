import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { scopedOrgIds } from '@/lib/access-scope'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { orgColumnInScope } from '@/app/api/admin/_scoping/org-scope'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

export async function contactScopeCondition(auth: Auth) {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return undefined
  if (scope.kind === 'none') return sql`0 = 1`
  return orgColumnInScope(schema.contacts.orgId, scope.orgIds, { includeNull: true })
}

export async function requireContactAccess(database: Database, auth: Auth, id: string) {
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') return null
  const [contact] = await database.select({ orgId: schema.contacts.orgId })
    .from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1)
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return requireAccessToOrgOrPreClient(database, auth.userId, contact.orgId)
}
