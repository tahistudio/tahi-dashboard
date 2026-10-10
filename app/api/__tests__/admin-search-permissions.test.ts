/**
 * Search must enforce the same feature and ownership decisions as the pages
 * it links to. Run the real route and SQL over an isolated SQLite database:
 * a recorder that ignores WHERE cannot prove tenant isolation or filtering
 * before LIMIT. Only auth and the two permission loaders are mocked.
 *
 * Nullable ownership follows the canonical routes: studio tasks and unlinked
 * deals are readable, calls require an org, and sales artifacts inherit their
 * linked deal's org only when their own org is absent. Docs are studio-wide;
 * doc_pages currently has no per-page audience or restriction columns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { getTableName } from 'drizzle-orm'
import { getTableConfig, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))
vi.mock('@/lib/access-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/access-scope')>()
  return { ...actual, scopedOrgIds: vi.fn(actual.scopedOrgIds) }
})

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { scopedOrgIds } from '@/lib/access-scope'
import { GET } from '@/app/api/admin/search/route'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const USER = 'user-scoped'
const OLD = '2026-09-01T00:00:00Z'
const NEW = '2026-10-01T00:00:00Z'

// These are explicit expectations, not a copy of a route-exported mapping.
// The studio catalogue and automations are exercised through Settings here;
// services itself is a client-only FEATURE_TREE key, not a team feature.
const GROUPS = [
  { type: 'request', feature: 'requests', table: schema.requests },
  { type: 'task', feature: 'tasks', table: schema.tasks },
  { type: 'client', feature: 'clients', table: schema.organisations },
  { type: 'brand', feature: 'clients', table: schema.brands },
  { type: 'contact', feature: 'clients', table: schema.contacts },
  { type: 'deal', feature: 'deals', table: schema.deals },
  { type: 'invoice', feature: 'invoices', table: schema.invoices },
  { type: 'contract', feature: 'contracts', table: schema.contractDocuments },
  { type: 'proposal', feature: 'proposals', table: schema.proposals },
  { type: 'schedule', feature: 'schedules', table: schema.projectSchedules },
  { type: 'doc', feature: 'docs', table: schema.docPages },
  { type: 'call', feature: 'calls', table: schema.scheduledCalls },
  { type: 'service', feature: 'settings', table: schema.services },
  { type: 'announcement', feature: 'announcements', table: schema.announcements },
  { type: 'automation', feature: 'settings', table: schema.automationRules },
  { type: 'team', feature: 'team', table: schema.teamMembers },
] as const

type Group = typeof GROUPS[number]
type GroupType = Group['type']
interface SearchItem { id: string; type: GroupType; title: string; href: string; sub?: string }
interface SearchBody {
  query: string
  totalCount: number
  suggestions: SearchItem[]
  groups: Array<{ type: GroupType; items: SearchItem[] }>
}

let sqlite: DatabaseSync
let access: ResolvedAccess
let queries: string[]
let queryErrors: string[]

function memberAccess(): ResolvedAccess {
  return {
    userId: USER, orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set([
      'requests', 'tasks', 'organisations', 'deals', 'invoices', 'contracts',
      'proposals', 'schedules', 'docs', 'calls', 'announcements', 'settings', 'team',
    ]),
    overrides: new Map(),
  }
}

function d1Adapter() {
  return {
    prepare(query: string) {
      queries.push(query)
      try {
        const statement = sqlite.prepare(query)
        const bind = (...params: unknown[]) => {
          const execute = <T,>(operation: () => T): T => {
            try {
              if (params.length > 100) throw new Error('D1 bound parameter limit exceeded')
              return operation()
            } catch (error) {
              queryErrors.push(String(error))
              throw error
            }
          }
          return {
            async all() {
              return { results: execute(() => statement.all(...params as SQLInputValue[])) }
            },
            async raw() {
              return execute(() => statement.all(...params as SQLInputValue[]).map(Object.values))
            },
            async run() {
              execute(() => statement.run(...params as SQLInputValue[]))
              return { success: true }
            },
          }
        }
        return { bind, ...bind() }
      } catch (error) {
        queryErrors.push(String(error))
        throw error
      }
    },
  }
}

// Column names and SQLite types come from the real schema. Constraints and
// foreign keys are irrelevant to these read-only fixtures and are omitted.
function createTable(table: AnySQLiteTable) {
  const { name, columns } = getTableConfig(table)
  sqlite.exec(`CREATE TABLE "${name}" (${columns.map(column =>
    `"${column.name}" ${column.getSQLType()}`,
  ).join(', ')})`)
}

function insert(table: AnySQLiteTable, values: Record<string, SQLInputValue>) {
  const keys = Object.keys(values)
  sqlite.prepare(`INSERT INTO "${getTableName(table)}" (${keys.map(key =>
    `"${key}"`,
  ).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(values))
}

function seed(group: Group, id: string, orgId: string | null = ORG_A,
  extras: Record<string, SQLInputValue> = {}) {
  const available = new Set(getTableConfig(group.table).columns.map(column => column.name))
  const candidates: Record<string, SQLInputValue> = {
    id, org_id: orgId, title: `needle ${id}`, name: `needle ${id}`,
    description: null, content_text: null, slug: id, email: `${id}@example.test`,
    status: 'draft', number: `needle ${id}`, role: 'member', enabled: 1,
    body: `needle ${id}`, type: 'info', target_type: 'all', target_ids: null,
    created_at: OLD, updated_at: OLD,
    ...extras,
  }
  insert(group.table, Object.fromEntries(Object.entries(candidates).filter(([key]) => available.has(key))))
}

function group(type: GroupType): Group {
  return GROUPS.find(candidate => candidate.type === type)!
}

function ids(body: SearchBody, type: GroupType): string[] {
  return body.groups.find(candidate => candidate.type === type)?.items.map(item => item.id) ?? []
}

function searchQueries(type: GroupType): string[] {
  return queries.filter(query =>
    query.includes(`from "${getTableName(group(type).table)}"`) && /\blimit\b/i.test(query),
  )
}

async function search(query = 'needle'): Promise<SearchBody> {
  const response = await GET(new NextRequest(`http://localhost/api/admin/search?q=${encodeURIComponent(query)}`))
  expect(response.status).toBe(200)
  // allSettled deliberately tolerates a broken group. Never let a fixture SQL
  // error masquerade as a correctly denied group in this regression suite.
  expect(queryErrors).toEqual([])
  const body = await response.json() as SearchBody
  expect(body.totalCount).toBe(body.groups.reduce((count, current) => count + current.items.length, 0))
  expect(body.suggestions).toEqual(body.groups.map(current => current.items[0]).slice(0, 5))
  return body
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  access = memberAccess()
  queries = []
  queryErrors = []
  sqlite = new DatabaseSync(':memory:')
  // Include the legacy contracts table empty: the canonical Contracts list
  // reads contract_documents, so searching retired rows is not a success.
  for (const table of [...GROUPS.map(current => current.table), schema.contracts]) createTable(table)
  const database = drizzle(d1Adapter() as unknown as AnyD1Database)
  vi.mocked(db).mockResolvedValue(database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: USER, orgId: 'org_tahi' } as never)
  vi.mocked(resolvePermissions).mockImplementation(async () => access)
  vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
  seed(group('client'), ORG_A)
  seed(group('client'), ORG_B)
  for (const current of GROUPS.filter(candidate => candidate.type !== 'client')) seed(current, `${current.type}-a`)
})

afterEach(() => {
  sqlite.close()
  vi.unstubAllEnvs()
})

describe('GET /api/admin/search feature permissions', () => {
  it('returns all 16 permitted groups and resolves permissions and scope once', async () => {
    const body = await search()
    expect(body.groups.map(current => current.type).sort()).toEqual(GROUPS.map(current => current.type).sort())
    expect(resolvePermissions).toHaveBeenCalledTimes(1)
    expect(scopedOrgIds).toHaveBeenCalledTimes(1)
    expect(resolveAccessScoping).toHaveBeenCalledTimes(1)
    expect(scopedOrgIds).toHaveBeenCalledWith({ userId: USER, orgId: 'org_tahi' }, access)
  })

  it.each(GROUPS)('does not query or expose $type when $feature is denied', async ({ type, feature }) => {
    access.overrides.set(feature, 'deny')
    const body = await search()
    expect(ids(body, type)).toEqual([])
    expect(body.suggestions.some(item => item.type === type)).toBe(false)
    expect(searchQueries(type)).toEqual([])
    // A denial must not turn an otherwise successful search into an empty
    // response. Keep a real allowed positive control in each matrix row.
    const control = type === 'request' ? 'task' : 'request'
    expect(ids(body, control)).toContain(`${control}-a`)
  })

  it('denies a roleless Tahi caller even when client scope is unrestricted', async () => {
    access.viewableResources = new Set()
    vi.mocked(resolveAccessScoping).mockResolvedValue(null)
    const body = await search()
    expect(body).toEqual({ query: 'needle', totalCount: 0, suggestions: [], groups: [] })
    expect(queries).toEqual([])
  })

  it('allows a deliberate single feature grant without granting every other group', async () => {
    access.viewableResources = new Set()
    access.overrides.set('tasks', 'allow')
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    seed(group('task'), 'task-studio', null)
    const body = await search()
    expect(body.groups.map(current => current.type)).toEqual(['task'])
    expect(ids(body, 'task')).toEqual(['task-studio'])
  })

  it('does not let a child allow override a denied parent search group', async () => {
    access.overrides.set('clients', 'deny')
    access.overrides.set('clients.billing_card', 'allow')
    access.overrides.set('requests', 'deny')
    access.overrides.set('requests.board', 'allow')
    const body = await search()
    for (const type of ['request', 'client', 'brand', 'contact'] as const) {
      expect(ids(body, type)).toEqual([])
      expect(searchQueries(type)).toEqual([])
    }
  })

  it('does not treat denial of a child card as denial of its permitted parent', async () => {
    access.overrides.set('clients.billing_card', 'deny')
    access.overrides.set('clients.engagement_health', 'deny')
    access.overrides.set('requests.board', 'deny')
    access.overrides.set('deals.engagement_health', 'deny')
    const body = await search()
    expect(ids(body, 'client')).toContain(ORG_A)
    expect(ids(body, 'request')).toContain('request-a')
    expect(ids(body, 'deal')).toContain('deal-a')
  })

  it.each(['super_admin', 'api-service'] as const)('%s retains every group and every client', async identity => {
    if (identity === 'super_admin') {
      access.level = 'super_admin'
      access.isSuperAdmin = true
      access.isAdmin = true
      access.viewableResources = null
      for (const current of GROUPS) access.overrides.set(current.feature, 'deny')
    } else {
      vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi' } as never)
      access.userId = 'api-service'
      access.level = 'admin'
      access.isAdmin = true
      access.viewableResources = null
    }
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    seed(group('request'), 'request-b', ORG_B)
    seed(group('proposal'), 'proposal-unassigned', null)
    seed(group('call'), 'call-unassigned', null)
    const body = await search()
    expect(body.groups).toHaveLength(16)
    expect(ids(body, 'request')).toContain('request-b')
    expect(ids(body, 'client')).toContain(ORG_B)
    expect(ids(body, 'proposal')).toContain('proposal-unassigned')
    expect(ids(body, 'call')).toContain('call-unassigned')
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })

  it.each([
    { userId: 'client-user', orgId: 'client-clerk-org' },
    { userId: null, orgId: null },
  ])('rejects a non-team caller before reading the database: $orgId', async auth => {
    vi.mocked(getRequestAuth).mockResolvedValue(auth as never)
    const response = await GET(new NextRequest('http://localhost/api/admin/search?q=needle'))
    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })

  it('returns an empty short query without resolving access or querying entities', async () => {
    expect(await search(' n ')).toEqual({ query: 'n', totalCount: 0, suggestions: [], groups: [] })
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(scopedOrgIds).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })
})

describe('GET /api/admin/search client ownership before LIMIT', () => {
  const ownedGroups = GROUPS.filter(current => [
    'request', 'task', 'client', 'brand', 'contact', 'deal', 'invoice',
    'contract', 'proposal', 'schedule', 'call', 'service',
  ].includes(current.type))

  it.each(ownedGroups)('keeps permitted $type matches behind newer forbidden matches', async current => {
    // More than one full page of newer forbidden matches defeats both a
    // missing filter and an in-memory filter applied after the six-row limit.
    for (let index = 0; index < 8; index++) {
      seed(current, `${current.type}-forbidden-${index}`, ORG_B, { updated_at: NEW })
    }
    const body = await search()
    const expected = current.type === 'client' ? ORG_A : `${current.type}-a`
    expect(ids(body, current.type)).toEqual([expected])
    expect(JSON.stringify(body)).not.toContain(`${current.type}-forbidden-`)
    expect(body.suggestions.some(item => item.id === expected)).toBe(
      body.groups.slice(0, 5).some(candidate => candidate.type === current.type),
    )
  })

  it('does not enrich allowed groups with another client name', async () => {
    seed(group('contact'), 'contact-secret', ORG_B, { updated_at: NEW })
    seed(group('invoice'), 'invoice-secret', ORG_B, { updated_at: NEW })
    const body = await search()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('needle org-b')
    expect(serialized).not.toContain('contact-secret')
    expect(serialized).not.toContain('invoice-secret')
    expect(body.groups.find(current => current.type === 'contact')?.items[0].sub).toBe('needle org-a')
  })

  it('honours an explicit all-clients rule for a non-admin member', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(null)
    seed(group('request'), 'request-b', ORG_B)
    expect(ids(await search(), 'request').sort()).toEqual(['request-a', 'request-b'])
  })

  it('handles a scope wider than the D1 parameter cap without dropping tenant filtering', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A, ...Array.from({ length: 110 }, (_, index) => `org-extra-${index}`)])
    seed(group('request'), 'request-b', ORG_B, { updated_at: NEW })
    expect(ids(await search(), 'request')).toEqual(['request-a'])
  })

  it('retains studio tasks, unlinked deals and global services for a scoped member', async () => {
    seed(group('task'), 'task-studio', null)
    seed(group('deal'), 'deal-unlinked', null)
    seed(group('service'), 'service-global', null)
    seed(group('call'), 'call-unassigned', null)
    const body = await search()
    expect(ids(body, 'task')).toContain('task-studio')
    expect(ids(body, 'deal')).toContain('deal-unlinked')
    expect(ids(body, 'service')).toContain('service-global')
    expect(ids(body, 'call')).not.toContain('call-unassigned')
  })

  it('with no client scope retains only canonical studio/global records', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    seed(group('task'), 'task-studio', null)
    seed(group('deal'), 'deal-unlinked', null)
    seed(group('service'), 'service-global', null)
    const body = await search()
    expect(ids(body, 'task')).toEqual(['task-studio'])
    expect(ids(body, 'service')).toEqual(['service-global'])
    for (const type of ['request', 'client', 'brand', 'contact', 'deal', 'invoice', 'contract', 'proposal', 'schedule', 'call'] as const) {
      expect(ids(body, type)).toEqual([])
    }
    expect(ids(body, 'doc')).toEqual(['doc-a'])
  })

  it.each(['proposal', 'schedule', 'contract'] as const)('%s inherits deal ownership only for null org, before LIMIT', async type => {
    const current = group(type)
    seed(group('deal'), 'deal-b', ORG_B)
    seed(current, `${type}-linked-a`, null, { deal_id: 'deal-a' })
    seed(current, `${type}-own-a-deal-b`, ORG_A, { deal_id: 'deal-b' })
    seed(current, `${type}-own-b-deal-a`, ORG_B, { deal_id: 'deal-a', updated_at: NEW })
    seed(current, `${type}-unassigned`, null, { updated_at: NEW })
    seed(current, `${type}-missing-deal`, null, { deal_id: 'missing-deal', updated_at: NEW })
    for (let index = 0; index < 8; index++) {
      seed(current, `${type}-linked-b-${index}`, null, { deal_id: 'deal-b', updated_at: NEW })
    }
    const body = await search()
    expect(ids(body, type).sort()).toEqual([
      `${type}-a`, `${type}-linked-a`, `${type}-own-a-deal-b`,
    ].sort())
    expect(JSON.stringify(body)).not.toContain(`${type}-linked-b-`)
    expect(ids(body, type)).not.toContain(`${type}-own-b-deal-a`)
    expect(ids(body, type)).not.toContain(`${type}-unassigned`)
    expect(ids(body, type)).not.toContain(`${type}-missing-deal`)
  })

  it('filters org-targeted announcements before LIMIT and retains non-client broadcasts', async () => {
    seed(group('announcement'), 'announcement-audience-a', null, { target_type: 'org', target_ids: JSON.stringify([ORG_A]) })
    seed(group('announcement'), 'announcement-mixed', null, { target_type: 'org', target_ids: JSON.stringify([ORG_A, ORG_B]) })
    seed(group('announcement'), 'announcement-plan', null, { target_type: 'plan_type', target_ids: null })
    seed(group('announcement'), 'announcement-malformed', null, { target_type: 'org', target_ids: '{bad', created_at: NEW })
    for (let index = 0; index < 8; index++) {
      seed(group('announcement'), `announcement-b-${index}`, null, {
        target_type: 'org', target_ids: JSON.stringify([ORG_B]), created_at: NEW,
      })
    }
    const body = await search()
    expect(ids(body, 'announcement').sort()).toEqual([
      'announcement-a', 'announcement-audience-a', 'announcement-mixed', 'announcement-plan',
    ].sort())
  })

  it.each([
    JSON.stringify(ORG_A),
    JSON.stringify({ unexpected: ORG_A }),
    JSON.stringify(null),
  ])('does not accept non-array announcement target ids: %s', async targetIds => {
    // The canonical parseTargetIds only accepts an array. json_each also
    // accepts objects and scalars, so json_valid alone is not sufficient.
    seed(group('announcement'), 'announcement-invalid-shape', null, {
      target_type: 'org', target_ids: targetIds, created_at: NEW,
    })
    const body = await search()
    expect(ids(body, 'announcement')).not.toContain('announcement-invalid-shape')
    expect(ids(body, 'announcement')).toContain('announcement-a')
  })
})

describe('GET /api/admin/search docs audience', () => {
  it('finds an allowed studio doc by content even with no client scope', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    seed(group('doc'), 'doc-content', null, { title: 'Operations handbook', content_text: 'needle in the body' })
    expect(ids(await search(), 'doc').sort()).toEqual(['doc-a', 'doc-content'])
  })

  it('hides docs when the role has other grants but no docs grant', async () => {
    access.viewableResources!.delete('docs')
    const body = await search()
    expect(ids(body, 'doc')).toEqual([])
    expect(searchQueries('doc')).toEqual([])
    expect(ids(body, 'request')).toEqual(['request-a'])
  })
})
