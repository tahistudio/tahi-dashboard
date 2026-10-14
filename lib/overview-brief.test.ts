import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { GET } from '@/app/api/admin/overview/brief/route'
import {
  BRIEF_CACHE_KEY,
  computeBrief,
  isBriefFresh,
  readBriefCache,
  sweepStaleBriefCache,
  writeBriefCache,
  type BriefResult,
  type D1,
} from '@/lib/overview-brief'
import { BRIEF_FEATURES, briefCacheKeyForFingerprint, briefScopeFingerprint } from '@/lib/brief-cache-key'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'tahi-org',
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))

const NOW = new Date('2026-10-10T01:00:00.000Z')
const AUTH = { userId: 'user-1', orgId: 'tahi-org', sessionId: 'session-1' }
const EMPTY: BriefResult = { urgent: [], week: [], slept: [] }
const OWNER_BRIEF: BriefResult = {
  urgent: [{ tone: 'risk', verb: 'Nudge', to: 'invoices', text: 'Owner-only overdue invoice' }],
  week: [],
  slept: [],
}
const dialect = new SQLiteSyncDialect()

function access(features: readonly string[]): ResolvedAccess {
  return {
    ...AUTH,
    level: 'team_member',
    audience: 'team',
    isAdmin: false,
    isSuperAdmin: false,
    canManagePermissions: false,
    viewableResources: new Set(),
    overrides: new Map(['overview', ...features].map(feature => [feature, 'allow'] as const)),
  }
}

interface Query { table?: unknown; condition?: SQL }
interface CacheRow { key: string; value: string; updatedAt: string }

// Execute the query chain while retaining its real Drizzle predicates. The
// settings store can contain the owner's row and several scoped rows at once.
function makeDb(rows: Map<unknown, unknown[] | Error> = new Map(), cache: Map<string, CacheRow> = new Map()) {
  if (!rows.has(schema.exchangeRates)) rows.set(schema.exchangeRates, [{ currency: 'NZD', rateToUsd: 0.6 }])
  const queries: Query[] = []
  const writes: Array<{ table: unknown; row: CacheRow; conflict: unknown }> = []
  const deletes: Query[] = []
  const handle = {
    select: () => {
      const query: Query = {}
      queries.push(query)
      const chain = {
        from: (table: unknown) => { query.table = table; return chain },
        leftJoin: () => chain,
        where: (condition: SQL) => { query.condition = condition; return chain },
        orderBy: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
          const result = query.table === schema.settings
            ? (() => {
              const key = dialect.sqlToQuery(query.condition!).params[0] as string
              const row = cache.get(key)
              return row ? [{ value: row.value }] : []
            })()
            : rows.get(query.table) ?? []
          return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject)
        },
      }
      return chain
    },
    insert: (table: unknown) => ({
      values: (row: CacheRow) => ({
        onConflictDoUpdate: async (conflict: unknown) => {
          writes.push({ table, row, conflict })
          cache.set(row.key, row)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (condition: SQL) => { deletes.push({ table, condition }) },
    }),
  }
  return { handle: handle as unknown as D1 & Awaited<ReturnType<typeof db>>, queries, writes, deletes, cache }
}

function cacheRow(key: string, result: BriefResult, generatedAt = NOW.toISOString()): CacheRow {
  return { key, value: JSON.stringify({ ...result, generatedAt }), updatedAt: generatedAt }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(getRequestAuth).mockResolvedValue(AUTH)
  vi.mocked(resolvePermissions).mockResolvedValue(access(BRIEF_FEATURES))
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

afterEach(() => { vi.useRealTimers() })

describe('overview brief freshness after the helper move', () => {
  it.each([
    ['2026-10-09T05:00:00.000Z', '2026-10-10T01:00:00.000Z', true],
    ['2026-10-09T04:59:59.999Z', '2026-10-10T01:00:00.000Z', false],
    ['2026-10-10T00:00:00.000Z', '2026-10-10T23:59:59.000Z', true],
    ['2026-10-10T01:00:00.001Z', '2026-10-10T01:00:00.000Z', false],
    ['invalid', '2026-10-10T01:00:00.000Z', false],
  ])('judges %s against %s as fresh=%s', (generatedAt, now, fresh) => {
    expect(isBriefFresh(generatedAt, new Date(now))).toBe(fresh)
  })
})

describe('overview brief cache helpers', () => {
  it('keeps the owner key and scoped key separate on both reads and atomic upserts', async () => {
    const { handle, queries, writes } = makeDb()
    const scopedKey = briefCacheKeyForFingerprint(BRIEF_CACHE_KEY, briefScopeFingerprint(['org-a'], ['requests']))

    await writeBriefCache(handle, OWNER_BRIEF, NOW.toISOString())
    await writeBriefCache(handle, EMPTY, NOW.toISOString(), scopedKey)
    expect(await readBriefCache(handle)).toEqual({ ...OWNER_BRIEF, generatedAt: NOW.toISOString() })
    expect(await readBriefCache(handle, scopedKey)).toEqual({ ...EMPTY, generatedAt: NOW.toISOString() })

    expect(writes.map(write => write.row.key)).toEqual([BRIEF_CACHE_KEY, scopedKey])
    expect(writes.every(write => write.table === schema.settings)).toBe(true)
    for (const write of writes) {
      expect(write.conflict).toEqual({ target: schema.settings.key, set: { value: write.row.value, updatedAt: NOW.toISOString() } })
    }
    expect(queries).toHaveLength(2)
  })

  it.each([
    '',
    'invalid json',
    'null',
    JSON.stringify({ ...EMPTY }),
    JSON.stringify({ ...EMPTY, urgent: {}, generatedAt: NOW.toISOString() }),
    JSON.stringify({ ...EMPTY, week: null, generatedAt: NOW.toISOString() }),
    JSON.stringify({ ...EMPTY, slept: 'invalid', generatedAt: NOW.toISOString() }),
  ])('treats a corrupt or incomplete cached value as a miss: %s', async value => {
    const row = { key: BRIEF_CACHE_KEY, value, updatedAt: NOW.toISOString() }
    const { handle } = makeDb(new Map(), new Map([[BRIEF_CACHE_KEY, row]]))
    expect(await readBriefCache(handle)).toBeNull()
  })

  it('treats a missing cache row as a miss', async () => {
    expect(await readBriefCache(makeDb().handle)).toBeNull()
  })

  it('limits stale-cache cleanup to scope-suffixed rows older than 24 hours', async () => {
    const { handle, deletes } = makeDb()
    await sweepStaleBriefCache(handle, NOW)

    expect(deletes).toHaveLength(1)
    expect(deletes[0].table).toBe(schema.settings)
    const query = dialect.sqlToQuery(deletes[0].condition!)
    expect(query.sql).toBe('("settings"."key" like ? and "settings"."updated_at" < ?)')
    expect(query.params).toEqual([`${BRIEF_CACHE_KEY}:%`, '2026-10-09T01:00:00.000Z'])
  })
})

describe('computeBrief permission and organisation scope', () => {
  it('denies all sources when the caller holds no feature grant', async () => {
    const { handle, queries } = makeDb()
    const result = await computeBrief(handle, AUTH, { access: access([]), allowedOrgs: null })

    expect(result).toEqual(EMPTY)
    expect(queries.map(query => query.table)).toEqual([schema.exchangeRates])
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })

  it.each([
    { feature: 'invoices', table: schema.invoices, count: 2 },
    { feature: 'contracts', table: schema.contractDocuments, count: 1 },
    { feature: 'requests', table: schema.requests, count: 2 },
    { feature: 'calls', table: schema.discoveryCalls, count: 1 },
    { feature: 'messages', table: schema.messages, count: 1 },
  ])('queries only the $feature source when only that feature is permitted', async ({ feature, table, count }) => {
    const { handle, queries } = makeDb()
    await computeBrief(handle, AUTH, { access: access([feature]), allowedOrgs: ['org-a'] })

    expect(queries.filter(query => query.table !== schema.exchangeRates).map(query => query.table)).toEqual(Array(count).fill(table))
    if (['invoices', 'contracts', 'requests'].includes(feature)) {
      for (const query of queries.filter(query => query.table === table)) {
        const predicate = dialect.sqlToQuery(query.condition!)
        expect(predicate.sql).toContain('"org_id" in (?)')
        expect(predicate.params).toContain('org-a')
      }
    }
  })

  it('denies client data for an empty organisation scope even when the features are granted', async () => {
    const { handle, queries } = makeDb()
    await computeBrief(handle, AUTH, { access: access(['invoices', 'contracts', 'requests']), allowedOrgs: [] })

    expect(queries.map(query => query.table)).toEqual([schema.exchangeRates])
  })

  it('resolves the refresh caller when prepared permissions are omitted and tolerates an unavailable source', async () => {
    const { handle, queries } = makeDb(new Map([[schema.invoices, new Error('missing table')]]))
    vi.mocked(resolvePermissions).mockResolvedValue(access(['invoices']))
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])

    expect(await computeBrief(handle, AUTH)).toEqual(EMPTY)
    expect(resolvePermissions).toHaveBeenCalledExactlyOnceWith(handle, AUTH)
    expect(resolveAccessScoping).toHaveBeenCalledExactlyOnceWith(handle, AUTH.userId)
    expect(queries.filter(query => query.table === schema.invoices)).toHaveLength(2)
  })
})

describe('GET overview brief after the helper move', () => {
  const request = () => new NextRequest('https://portal.tahi.studio/api/admin/overview/brief')

  it('keeps the owner on the cron-warmed base key and serves a fresh hit without recomputing or sweeping', async () => {
    const { handle, queries, writes, deletes } = makeDb(new Map(), new Map([[BRIEF_CACHE_KEY, cacheRow(BRIEF_CACHE_KEY, OWNER_BRIEF)]]))
    vi.mocked(db).mockResolvedValue(handle)

    const response = await GET(request())

    expect(await response.json()).toEqual({ ...OWNER_BRIEF, generatedAt: NOW.toISOString() })
    expect(queries).toHaveLength(1)
    expect(dialect.sqlToQuery(queries[0].condition!).params).toEqual([BRIEF_CACHE_KEY])
    expect(writes).toEqual([])
    expect(deletes).toEqual([])
    expect(resolvePermissions).toHaveBeenCalledTimes(2)
    expect(resolveAccessScoping).toHaveBeenCalledTimes(1)
  })

  it('never serves or overwrites the owner cache when a scoped caller misses', async () => {
    const ownerRow = cacheRow(BRIEF_CACHE_KEY, OWNER_BRIEF)
    const { handle, queries, writes, cache } = makeDb(new Map(), new Map([[BRIEF_CACHE_KEY, ownerRow]]))
    vi.mocked(db).mockResolvedValue(handle)
    vi.mocked(resolvePermissions).mockResolvedValue(access(['requests']))
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])

    const response = await GET(request())

    expect(await response.json()).toEqual({ ...EMPTY, generatedAt: NOW.toISOString() })
    const scopedKey = briefCacheKeyForFingerprint(BRIEF_CACHE_KEY, briefScopeFingerprint(['org-a'], ['requests']))
    expect(dialect.sqlToQuery(queries[0].condition!).params).toEqual([scopedKey])
    expect(writes.map(write => write.row.key)).toEqual([scopedKey])
    expect(cache.get(BRIEF_CACHE_KEY)).toEqual(ownerRow)
    expect(resolvePermissions).toHaveBeenCalledTimes(2)
    expect(resolveAccessScoping).toHaveBeenCalledTimes(1)
  })

  it('changes the cache key when a caller loses a feature', async () => {
    const oldKey = briefCacheKeyForFingerprint(BRIEF_CACHE_KEY, briefScopeFingerprint(['org-a'], BRIEF_FEATURES))
    const { handle, cache, writes } = makeDb(new Map(), new Map([[oldKey, cacheRow(oldKey, OWNER_BRIEF)]]))
    vi.mocked(db).mockResolvedValue(handle)
    vi.mocked(resolvePermissions).mockResolvedValue(access(['requests']))
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])

    const response = await GET(request())

    expect(await response.json()).toEqual({ ...EMPTY, generatedAt: NOW.toISOString() })
    expect(writes[0].row.key).not.toBe(oldKey)
    expect(cache.get(oldKey)?.value).toContain('Owner-only overdue invoice')
  })

  it('rejects a non-Tahi caller before accessing the cache or resolving permissions', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client-1', orgId: 'client-org', sessionId: 'client-session' })
    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(resolveAccessScoping).not.toHaveBeenCalled()
  })
})
