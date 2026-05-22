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
import { or, like, sql, desc } from 'drizzle-orm'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

const PER_GROUP_LIMIT = 6
const SUGGESTIONS_LIMIT = 5

export type SearchGroupType =
  | 'request' | 'task' | 'client' | 'brand' | 'contact'
  | 'deal' | 'invoice' | 'contract' | 'proposal' | 'schedule'
  | 'doc' | 'call' | 'service' | 'announcement'
  | 'automation' | 'team'

export interface SearchResultItem {
  type: SearchGroupType
  id: string
  title: string
  sub?: string
  badge?: string
  href: string
}

export interface SearchResponse {
  query: string
  totalCount: number
  suggestions: SearchResultItem[]
  groups: Array<{
    type: SearchGroupType
    label: string
    items: SearchResultItem[]
  }>
}

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

  const needle = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`
  const database = await db()

  // Run every group query in parallel. A failure in one group must not
  // sink the whole search; we Promise.allSettled and silently drop
  // groups that errored.
  const [
    requestsRes, tasksRes, clientsRes, brandsRes, contactsRes,
    dealsRes, invoicesRes, contractsRes, proposalsRes, schedulesRes,
    docsRes, callsRes, servicesRes, announcementsRes, automationsRes, teamRes,
  ] = await Promise.allSettled([
    database.select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      orgId: schema.requests.orgId,
    }).from(schema.requests).where(
      or(
        like(schema.requests.title, needle),
        like(schema.requests.description, needle),
      ),
    ).orderBy(desc(schema.requests.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
    }).from(schema.tasks).where(
      or(
        like(schema.tasks.title, needle),
        like(schema.tasks.description, needle),
      ),
    ).orderBy(desc(schema.tasks.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      status: schema.organisations.status,
    }).from(schema.organisations).where(
      like(schema.organisations.name, needle),
    ).orderBy(desc(schema.organisations.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.brands.id,
      name: schema.brands.name,
      orgId: schema.brands.orgId,
    }).from(schema.brands).where(
      like(schema.brands.name, needle),
    ).orderBy(desc(schema.brands.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      orgId: schema.contacts.orgId,
    }).from(schema.contacts).where(
      or(
        like(schema.contacts.name, needle),
        like(schema.contacts.email, needle),
      ),
    ).orderBy(desc(schema.contacts.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.deals.id,
      title: schema.deals.title,
      stageId: schema.deals.stageId,
    }).from(schema.deals).where(
      like(schema.deals.title, needle),
    ).orderBy(desc(schema.deals.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.invoices.id,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      status: schema.invoices.status,
      orgId: schema.invoices.orgId,
      notes: schema.invoices.notes,
    }).from(schema.invoices).where(
      or(
        like(schema.invoices.notes, needle),
        like(schema.invoices.stripeInvoiceId, needle),
        like(schema.invoices.xeroInvoiceId, needle),
        like(schema.invoices.id, needle),
      ),
    ).orderBy(desc(schema.invoices.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.contracts.id,
      name: schema.contracts.name,
      status: schema.contracts.status,
      orgId: schema.contracts.orgId,
    }).from(schema.contracts).where(
      like(schema.contracts.name, needle),
    ).orderBy(desc(schema.contracts.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.proposals.id,
      title: schema.proposals.title,
      status: schema.proposals.status,
    }).from(schema.proposals).where(
      like(schema.proposals.title, needle),
    ).orderBy(desc(schema.proposals.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      orgId: schema.projectSchedules.orgId,
    }).from(schema.projectSchedules).where(
      like(schema.projectSchedules.title, needle),
    ).orderBy(desc(schema.projectSchedules.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.docPages.id,
      title: schema.docPages.title,
      slug: schema.docPages.slug,
    }).from(schema.docPages).where(
      or(
        like(schema.docPages.title, needle),
        like(schema.docPages.contentText, needle),
      ),
    ).orderBy(desc(schema.docPages.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.scheduledCalls.id,
      title: schema.scheduledCalls.title,
      status: schema.scheduledCalls.status,
      orgId: schema.scheduledCalls.orgId,
    }).from(schema.scheduledCalls).where(
      or(
        like(schema.scheduledCalls.title, needle),
        like(schema.scheduledCalls.description, needle),
      ),
    ).orderBy(desc(schema.scheduledCalls.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.services.id,
      name: schema.services.name,
    }).from(schema.services).where(
      or(
        like(schema.services.name, needle),
        like(schema.services.description, needle),
      ),
    ).orderBy(desc(schema.services.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      type: schema.announcements.type,
    }).from(schema.announcements).where(
      or(
        like(schema.announcements.title, needle),
        like(schema.announcements.body, needle),
      ),
    ).orderBy(desc(schema.announcements.createdAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.automationRules.id,
      name: schema.automationRules.name,
      enabled: schema.automationRules.enabled,
    }).from(schema.automationRules).where(
      like(schema.automationRules.name, needle),
    ).orderBy(desc(schema.automationRules.updatedAt)).limit(PER_GROUP_LIMIT),

    database.select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      role: schema.teamMembers.role,
    }).from(schema.teamMembers).where(
      or(
        like(schema.teamMembers.name, needle),
        like(schema.teamMembers.email, needle),
      ),
    ).orderBy(desc(schema.teamMembers.updatedAt)).limit(PER_GROUP_LIMIT),
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
      sub: orgNameById.get(r.orgId),
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
      sub: orgNameById.get(r.orgId),
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
      title: r.stripeInvoiceId
        ?? r.xeroInvoiceId
        ?? `Invoice ${r.id.slice(0, 8)}`,
      sub: orgNameById.get(r.orgId),
      badge: r.status,
      href: `/invoices/${r.id}`,
    })),
    contract: fromResult(contractsRes, r => ({
      type: 'contract',
      id: r.id,
      title: r.name,
      sub: orgNameById.get(r.orgId),
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
      href: r.slug ? `/docs?doc=${encodeURIComponent(r.slug)}` : '/docs',
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
