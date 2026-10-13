import { and, eq, sql, type SQL } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { scopedOrgIds } from '@/lib/access-scope'
import { requireAccessToOrg, requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { can, resolvePermissions } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

export interface ActivityLinks {
  orgId?: string | null
  dealId?: string | null
  contactId?: string | null
  leadId?: string | null
}

/** Validate every link, so an allowed org cannot mask a foreign contact or deal. */
export async function requireActivityLinks(database: D1, auth: Auth, links: ActivityLinks) {
  const features = [
    ...(links.orgId || links.contactId ? ['clients'] : []),
    ...(links.dealId ? ['deals'] : []),
    ...(links.leadId ? ['leads'] : []),
  ]
  if (features.length) {
    const featureDenied = await requireFeature(auth, features)
    if (featureDenied) return featureDenied
  } else {
    const access = await resolvePermissions(database, auth)
    const scope = await scopedOrgIds(auth, access)
    if (scope.kind !== 'all' || !['clients', 'deals', 'leads'].some(feature => can(access, feature))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (links.orgId) {
    const denied = await requireAccessToOrg(database, auth.userId, links.orgId)
    if (denied) return denied
  }
  if (links.contactId) {
    const [contact] = await database.select({ orgId: schema.contacts.orgId }).from(schema.contacts)
      .where(eq(schema.contacts.id, links.contactId)).limit(1)
    const denied = await requireAccessToOrg(database, auth.userId, contact?.orgId)
    if (denied) return denied
  }
  if (links.dealId) {
    const [deal] = await database.select({ orgId: schema.deals.orgId }).from(schema.deals)
      .where(eq(schema.deals.id, links.dealId)).limit(1)
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    const denied = await requireAccessToOrgOrPreClient(database, auth.userId, deal.orgId)
    if (denied) return denied
  }
  if (links.leadId) {
    const [lead] = await database.select({ id: schema.leads.id }).from(schema.leads)
      .where(eq(schema.leads.id, links.leadId)).limit(1)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const denied = await requireAccessToOrgOrPreClient(database, auth.userId, null)
    if (denied) return denied
  }
  return null
}

/** Apply both feature and org restrictions before the activity list's LIMIT. */
export async function activityListWhere(database: D1, auth: Auth): Promise<SQL> {
  const access = await resolvePermissions(database, auth)
  const scope = await scopedOrgIds(auth, access)
  if (scope.kind === 'none' || !['clients', 'deals', 'leads'].some(feature => can(access, feature))) {
    return sql`0 = 1`
  }
  const orgOwned = scope.kind === 'all' ? sql`1 = 1`
    : sql`${schema.activities.orgId} IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))`
  const contactOwned = scope.kind === 'all' ? sql`1 = 1`
    : sql`contacts.org_id IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))`
  const dealOwned = scope.kind === 'all' ? sql`1 = 1`
    : sql`(deals.org_id IS NULL OR deals.org_id IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)})))`
  return and(
    can(access, 'clients')
      ? sql`(${schema.activities.orgId} IS NULL OR ${orgOwned}) AND (${schema.activities.contactId} IS NULL OR EXISTS (SELECT 1 FROM contacts WHERE contacts.id = ${schema.activities.contactId} AND ${contactOwned}))`
      : sql`${schema.activities.orgId} IS NULL AND ${schema.activities.contactId} IS NULL`,
    can(access, 'deals')
      ? sql`(${schema.activities.dealId} IS NULL OR EXISTS (SELECT 1 FROM deals WHERE deals.id = ${schema.activities.dealId} AND ${dealOwned}))`
      : sql`${schema.activities.dealId} IS NULL`,
    can(access, 'leads')
      ? sql`(${schema.activities.leadId} IS NULL OR EXISTS (SELECT 1 FROM leads WHERE leads.id = ${schema.activities.leadId}))`
      : sql`${schema.activities.leadId} IS NULL`,
    scope.kind === 'all' ? undefined
      : sql`(${schema.activities.orgId} IS NOT NULL OR ${schema.activities.contactId} IS NOT NULL OR ${schema.activities.dealId} IS NOT NULL OR ${schema.activities.leadId} IS NOT NULL)`,
  )!
}
