/**
 * Global admin search.
 *
 * GET /api/admin/search?q=<query>
 *
 * Returns grouped matches across every dynamic entity in the dashboard.
 * Each group is capped (default 6) so the palette stays tight. A
 * cross-group "suggestions" list takes the top item from each group so
 * the user sees the breadth of results immediately.
 *
 * Search uses SQLite LIKE with %query% on the relevant text columns.
 * Per-group results are ordered by updated_at DESC then created_at DESC
 * so recently-touched items rank above stale ones. Tahi admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, or, sql, desc, isNull, type SQL } from 'drizzle-orm'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { AUDIT_LIKE_ESCAPE, escapeAuditLikePrefix } from '@/lib/audit'
import { schema } from '@/db/d1'
import { resolvePermissions, can } from '@/lib/permissions'
import { scopedOrgIds } from '@/lib/access-scope'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { SearchGroupType, SearchResultItem, SearchResponse } from '@/lib/global-search'

const PER_GROUP_LIMIT = 6
const SUGGESTIONS_LIMIT = 5

const GROUP_LABEL: Record<SearchGroupType, string> = {
  request: 'Requests',
  task: 'Tasks',
  client: 'Clients',
  brand: 'Brands',
  contact: 'Contacts',
  deal: 'Deals',
  invoice: 'Invoices',
  contract: 'Contracts',
  proposal: 'Proposals',
  schedule: 'Schedules',
  doc: 'Docs',
  call: 'Calls',
  service: 'Services',
  announcement: 'Announcements',
  automation: 'Automations',
  team: 'Team',
}

// Build a list of ordered groups so the UI renders deterministically.
const GROUP_ORDER: SearchGroupType[] = [
  'request', 'task', 'client', 'deal', 'proposal',
  'invoice', 'contract', 'schedule', 'doc', 'brand',
  'contact', 'call', 'service', 'announcement',
  'automation', 'team',
]

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return NextResponse.json<SearchResponse>({
      query: q,
      totalCount: 0,
      suggestions: [],
      groups: [],
    })
  }

  const needle = `%${escapeAuditLikePrefix(q)}%`
  const literalLike = (column: SQLiteColumn): SQL =>
    sql`${column} LIKE ${needle} ESCAPE ${AUDIT_LIKE_ESCAPE}`
  const database = await db()

  const access = await resolvePermissions(database, { userId, orgId })
  const scope = await scopedOrgIds({ userId, orgId }, access)
  const features: Record<SearchGroupType, string> = {
    request: 'requests', task: 'tasks', client: 'clients', brand: 'clients', contact: 'clients',
    deal: 'deals', invoice: 'invoices', contract: 'contracts', proposal: 'proposals',
    schedule: 'schedules', doc: 'docs', call: 'calls', service: 'settings',
    announcement: 'announcements', automation: 'settings', team: 'team',
  }
  const run = <T,>(type: SearchGroupType, query: () => PromiseLike<T[]>): Promise<T[]> =>
    can(access, features[type]) ? Promise.resolve(query()) : Promise.resolve([])

  // Bind the whole scope once per predicate, staying below D1's parameter cap.
  const owned = (column: SQLiteColumn | SQL, includeNull = false): SQL | undefined => {
    if (scope.kind === 'all') return undefined
    const match = scope.kind === 'none'
      ? sql`0 = 1`
      : sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))`
    return includeNull ? or(match, isNull(column)) : match
  }
  const artifactOwned = (org: SQLiteColumn, deal: SQLiteColumn): SQL | undefined =>
    owned(sql`coalesce(${org}, (SELECT org_id FROM deals WHERE id = ${deal}))`)

  // Run every group query in parallel. A failure in one group must not
  // sink the whole search; we Promise.allSettled and silently drop
  // groups that errored.
  const [
    requestsRes, tasksRes, clientsRes, brandsRes, contactsRes,
    dealsRes, invoicesRes, contractsRes, proposalsRes, schedulesRes,
    docsRes, callsRes, servicesRes, announcementsRes, automationsRes, teamRes,
  ] = await Promise.allSettled([
    run('request', () => database.select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      orgId: schema.requests.orgId,
    }).from(schema.requests).where(and(
      owned(schema.requests.orgId),
      or(
        literalLike(schema.requests.title),
        literalLike(schema.requests.description),
      ),
    )).orderBy(desc(schema.requests.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('task', () => database.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
    }).from(schema.tasks).where(and(
      owned(schema.tasks.orgId, true),
      or(
        literalLike(schema.tasks.title),
        literalLike(schema.tasks.description),
      ),
    )).orderBy(desc(schema.tasks.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('client', () => database.select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      status: schema.organisations.status,
    }).from(schema.organisations).where(and(
      owned(schema.organisations.id),
      literalLike(schema.organisations.name),
    )).orderBy(desc(schema.organisations.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('brand', () => database.select({
      id: schema.brands.id,
      name: schema.brands.name,
      orgId: schema.brands.orgId,
    }).from(schema.brands).where(and(
      owned(schema.brands.orgId),
      literalLike(schema.brands.name),
    )).orderBy(desc(schema.brands.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('contact', () => database.select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      orgId: schema.contacts.orgId,
    }).from(schema.contacts).where(and(
      owned(schema.contacts.orgId),
      or(
        literalLike(schema.contacts.name),
        literalLike(schema.contacts.email),
      ),
    )).orderBy(desc(schema.contacts.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('deal', () => database.select({
      id: schema.deals.id,
      title: schema.deals.title,
      stageId: schema.deals.stageId,
    }).from(schema.deals).where(and(
      scope.kind === 'none' ? sql`0 = 1` : owned(schema.deals.orgId, true),
      sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`,
      literalLike(schema.deals.title),
    )).orderBy(desc(schema.deals.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('invoice', () => database.select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      status: schema.invoices.status,
      orgId: schema.invoices.orgId,
      notes: schema.invoices.notes,
    }).from(schema.invoices).where(and(
      owned(schema.invoices.orgId),
      or(
        // The number goes FIRST because it is the only one of these a human
        // types: it is what the client quotes, what the email prints and what
        // Xero shows. Searching an invoice used to mean knowing a Stripe id.
        literalLike(schema.invoices.number),
        literalLike(schema.invoices.notes),
        literalLike(schema.invoices.stripeInvoiceId),
        literalLike(schema.invoices.xeroInvoiceId),
        literalLike(schema.invoices.id),
      ),
    )).orderBy(desc(schema.invoices.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('contract', () => database.select({
      id: schema.contractDocuments.id,
      name: schema.contractDocuments.name,
      status: schema.contractDocuments.status,
      orgId: schema.contractDocuments.orgId,
    }).from(schema.contractDocuments).where(and(
      artifactOwned(schema.contractDocuments.orgId, schema.contractDocuments.dealId),
      literalLike(schema.contractDocuments.name),
    )).orderBy(desc(schema.contractDocuments.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('proposal', () => database.select({
      id: schema.proposals.id,
      title: schema.proposals.title,
      status: schema.proposals.status,
    }).from(schema.proposals).where(and(
      artifactOwned(schema.proposals.orgId, schema.proposals.dealId),
      literalLike(schema.proposals.title),
    )).orderBy(desc(schema.proposals.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('schedule', () => database.select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      orgId: schema.projectSchedules.orgId,
    }).from(schema.projectSchedules).where(and(
      artifactOwned(schema.projectSchedules.orgId, schema.projectSchedules.dealId),
      literalLike(schema.projectSchedules.title),
    )).orderBy(desc(schema.projectSchedules.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('doc', () => database.select({
      id: schema.docPages.id,
      title: schema.docPages.title,
      slug: schema.docPages.slug,
    }).from(schema.docPages).where(
      or(
        literalLike(schema.docPages.title),
        literalLike(schema.docPages.contentText),
      ),
    ).orderBy(desc(schema.docPages.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('call', () => database.select({
      id: schema.scheduledCalls.id,
      title: schema.scheduledCalls.title,
      status: schema.scheduledCalls.status,
      orgId: schema.scheduledCalls.orgId,
    }).from(schema.scheduledCalls).where(and(
      owned(schema.scheduledCalls.orgId),
      or(
        literalLike(schema.scheduledCalls.title),
        literalLike(schema.scheduledCalls.description),
      ),
    )).orderBy(desc(schema.scheduledCalls.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('service', () => database.select({
      id: schema.services.id,
      name: schema.services.name,
    }).from(schema.services).where(and(
      owned(schema.services.orgId, true),
      or(
        literalLike(schema.services.name),
        literalLike(schema.services.description),
      ),
    )).orderBy(desc(schema.services.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('announcement', () => database.select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      type: schema.announcements.type,
    }).from(schema.announcements).where(and(
      scope.kind === 'all' ? undefined : sql`(${schema.announcements.targetType} != 'org' OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${schema.announcements.targetIds}) AND json_type(${schema.announcements.targetIds}) = 'array' THEN ${schema.announcements.targetIds} ELSE '[]' END) AS target WHERE ${scope.kind === 'some' ? sql`target.value IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))` : sql`0 = 1`}))`,
      or(
        literalLike(schema.announcements.title),
        literalLike(schema.announcements.body),
      ),
    )).orderBy(desc(schema.announcements.createdAt)).limit(PER_GROUP_LIMIT)),

    run('automation', () => database.select({
      id: schema.automationRules.id,
      name: schema.automationRules.name,
      enabled: schema.automationRules.enabled,
    }).from(schema.automationRules).where(
      literalLike(schema.automationRules.name),
    ).orderBy(desc(schema.automationRules.updatedAt)).limit(PER_GROUP_LIMIT)),

    run('team', () => database.select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      role: schema.teamMembers.role,
    }).from(schema.teamMembers).where(
      or(
        literalLike(schema.teamMembers.name),
        literalLike(schema.teamMembers.email),
      ),
    ).orderBy(desc(schema.teamMembers.updatedAt)).limit(PER_GROUP_LIMIT)),
  ])

  // Fetch org names referenced by any of the results so we can render
  // "Acme Co" on a contact / invoice / contract / brand result. One
  // small extra query keyed by the set of orgIds we've seen.
  const orgIds = new Set<string>()
  const collectOrg = <T extends { orgId?: string | null }>(r: PromiseSettledResult<T[]>) => {
    if (r.status !== 'fulfilled') return
    for (const row of r.value) if (row.orgId) orgIds.add(row.orgId)
  }
  collectOrg(requestsRes)
  collectOrg(brandsRes)
  collectOrg(contactsRes)
  collectOrg(invoicesRes)
  collectOrg(contractsRes)
  collectOrg(schedulesRes)
  collectOrg(callsRes)

  const orgNameById = new Map<string, string>()
  if (orgIds.size > 0) {
    const orgRows = await database.select({
      id: schema.organisations.id,
      name: schema.organisations.name,
    }).from(schema.organisations).where(
      sql`${schema.organisations.id} IN (${sql.join(Array.from(orgIds).map(id => sql`${id}`), sql`, `)})`,
    )
    for (const row of orgRows) orgNameById.set(row.id, row.name)
  }

  // Helpers to turn settled query results into SearchResultItems.
  const fromResult = <T,>(
    r: PromiseSettledResult<T[]>,
    mapper: (row: T) => SearchResultItem,
  ): SearchResultItem[] => {
    if (r.status !== 'fulfilled') return []
    return r.value.map(mapper)
  }

  const itemsByType: Partial<Record<SearchGroupType, SearchResultItem[]>> = {
    request: fromResult(requestsRes, r => ({
      type: 'request',
      id: r.id,
      title: r.title,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      badge: r.status,
      href: `/requests/${r.id}`,
    })),
    task: fromResult(tasksRes, r => ({
      type: 'task',
      id: r.id,
      title: r.title,
      badge: r.status,
      href: `/tasks/${r.id}`,
    })),
    client: fromResult(clientsRes, r => ({
      type: 'client',
      id: r.id,
      title: r.name,
      badge: r.status,
      href: `/clients/${r.id}`,
    })),
    brand: fromResult(brandsRes, r => ({
      type: 'brand',
      id: r.id,
      title: r.name,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      href: `/clients/brands/${r.id}`,
    })),
    contact: fromResult(contactsRes, r => ({
      type: 'contact',
      id: r.id,
      title: r.name,
      sub: orgNameById.get(r.orgId) ?? r.email,
      href: `/clients/contacts/${r.id}`,
    })),
    deal: fromResult(dealsRes, r => ({
      type: 'deal',
      id: r.id,
      title: r.title,
      href: `/pipeline/${r.id}`,
    })),
    invoice: fromResult(invoicesRes, r => ({
      type: 'invoice',
      id: r.id,
      // The number when the row has one, then the rail ids, then the short id.
      title: r.number
        ?? r.stripeInvoiceId
        ?? r.xeroInvoiceId
        ?? `Invoice ${r.id.slice(0, 8)}`,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      badge: r.status,
      href: `/invoices/${r.id}`,
    })),
    contract: fromResult(contractsRes, r => ({
      type: 'contract',
      id: r.id,
      title: r.name,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      badge: r.status,
      href: `/contracts/${r.id}`,
    })),
    proposal: fromResult(proposalsRes, r => ({
      type: 'proposal',
      id: r.id,
      title: r.title,
      badge: r.status,
      href: `/proposals/${r.id}`,
    })),
    schedule: fromResult(schedulesRes, r => ({
      type: 'schedule',
      id: r.id,
      title: r.title,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      href: `/schedules/${r.id}`,
    })),
    doc: fromResult(docsRes, r => ({
      type: 'doc',
      id: r.id,
      title: r.title,
      href: `/docs?doc=${encodeURIComponent(r.id)}`,
    })),
    call: fromResult(callsRes, r => ({
      type: 'call',
      id: r.id,
      title: r.title,
      sub: r.orgId ? orgNameById.get(r.orgId) : undefined,
      badge: r.status,
      href: r.orgId ? `/clients/${r.orgId}?tab=calls` : '/overview',
    })),
    service: fromResult(servicesRes, r => ({
      type: 'service',
      id: r.id,
      title: r.name,
      href: `/services`,
    })),
    announcement: fromResult(announcementsRes, r => ({
      type: 'announcement',
      id: r.id,
      title: r.title,
      badge: r.type,
      href: `/announcements`,
    })),
    automation: fromResult(automationsRes, r => ({
      type: 'automation',
      id: r.id,
      title: r.name,
      badge: r.enabled ? 'active' : 'inactive',
      href: `/settings/automations`,
    })),
    team: fromResult(teamRes, r => ({
      type: 'team',
      id: r.id,
      title: r.name,
      sub: r.email,
      badge: r.role,
      href: `/team`,
    })),
  }

  const groups = GROUP_ORDER
    .map(type => ({
      type,
      label: GROUP_LABEL[type],
      items: itemsByType[type] ?? [],
    }))
    .filter(g => g.items.length > 0)

  // Suggestions: take the top item from each non-empty group, in the
  // same order, up to SUGGESTIONS_LIMIT. Gives a flavour of the
  // breadth of results without ranking complexity.
  const suggestions = groups
    .map(g => g.items[0])
    .slice(0, SUGGESTIONS_LIMIT)

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0)

  return NextResponse.json<SearchResponse>({
    query: q,
    totalCount,
    suggestions,
    groups,
  })
}
