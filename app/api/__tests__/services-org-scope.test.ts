/**
 * CT.11, the scoping half: the services catalogue learns who it belongs to.
 *
 * GET /api/portal/services served every show_in_catalog = 1 row to every
 * client, because `services` had nothing on it to scope by. That was
 * survivable while the catalogue was eight generic lines the studio wrote
 * itself and stops being survivable the moment the ManyRequests import lands
 * 18 services named for the clients they were priced for.
 *
 * The portal half of this file runs the route against a REAL SQLite database
 * (node:sqlite behind a D1-shaped adapter, driving the real drizzle d1 driver),
 * because the thing under test is a WHERE clause: a mocked query builder that
 * ignores conditions would pass whatever the filter said and prove nothing.
 * Three rows go in, and what comes out is the whole assertion.
 *
 * The admin half uses the repo's recorder-style fake, because what is under
 * test there is the ORDER of the guards (403 before existence, 400 on an org
 * that is not a client) rather than any SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  getPortalAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

import { db } from '@/lib/db'
import { getPortalAuth, getRequestAuth } from '@/lib/server-auth'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { NextRequest } from 'next/server'

import { GET as portalServices } from '@/app/api/portal/services/route'
import { GET as adminServices, POST as adminCreateService } from '@/app/api/admin/services/route'
import { PATCH as adminUpdateService } from '@/app/api/admin/services/[id]/route'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

// ---------------------------------------------------------------------------
// A real SQLite database behind the D1 shape drizzle's d1 driver calls:
// prepare(sql).bind(...params) then .all() / .run() / .raw().
// ---------------------------------------------------------------------------
interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean }>
  raw(): Promise<unknown[][]>
}

function d1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          return { results: stmt.all(...(params as never[])) as unknown[] }
        },
        async run() {
          stmt.run(...(params as never[]))
          return { success: true }
        },
        async raw() {
          const rows = stmt.all(...(params as never[])) as Array<Record<string, unknown>>
          // node:sqlite answers objects; drizzle's `values()` wants the row as
          // an array in column order, which is the object's own key order.
          return rows.map((row) => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

type ServiceSeed = {
  id: string
  name: string
  showInCatalog?: number
  visibility?: string
  orgId?: string | null
}

function seedDatabase(rows: ServiceSeed[]) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE services (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text,
      price integer NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'NZD',
      is_recurring integer NOT NULL DEFAULT 0,
      recurring_interval text,
      show_in_catalog integer NOT NULL DEFAULT 1,
      category text,
      manyrequests_id text,
      org_id text,
      visibility text NOT NULL DEFAULT 'public',
      created_at text NOT NULL,
      updated_at text NOT NULL
    )
  `)
  const insert = sqlite.prepare(
    `INSERT INTO services (id, name, show_in_catalog, visibility, org_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  )
  for (const row of rows) {
    insert.run(
      row.id,
      row.name,
      row.showInCatalog ?? 1,
      row.visibility ?? 'public',
      row.orgId ?? null,
    )
  }
  // The adapter implements the slice of D1 the driver actually calls, not the
  // whole Cloudflare D1Database surface, so it is widened rather than faked.
  return drizzle(d1Adapter(sqlite) as unknown as AnyD1Database)
}

/** The three rows every portal case is decided against. */
const CATALOGUE: ServiceSeed[] = [
  { id: 'svc-global', name: 'Website care', orgId: null },
  { id: 'svc-a', name: 'Acme Custom Retainer', orgId: ORG_A },
  { id: 'svc-b', name: 'Beta Custom Retainer', orgId: ORG_B },
  { id: 'svc-global-hidden', name: 'Draft offering', orgId: null, visibility: 'hidden' },
  { id: 'svc-a-hidden', name: 'Acme secret', orgId: ORG_A, visibility: 'hidden' },
  { id: 'svc-global-unpublished', name: 'Imported from ManyRequests', orgId: null, showInCatalog: 0 },
]

function asClient(orgId: string) {
  vi.mocked(getPortalAuth).mockResolvedValue({
    userId: `user-${orgId}`,
    orgId,
    clerkOrgId: `clerk-${orgId}`,
    impersonating: false,
  } as never)
}

const req = (url: string) => new NextRequest(`http://localhost:3000${url}`)

async function portalNames(orgId: string): Promise<string[]> {
  asClient(orgId)
  vi.mocked(db).mockResolvedValue(seedDatabase(CATALOGUE) as never)
  const res = await portalServices(req('/api/portal/services'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { items: Array<{ id: string }> }
  return body.items.map((i) => i.id)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

// ---------------------------------------------------------------------------
// GET /api/portal/services
// ---------------------------------------------------------------------------
describe('GET /api/portal/services', () => {
  it("never hands org A's private row to org B, and the reverse", async () => {
    const forA = await portalNames(ORG_A)
    const forB = await portalNames(ORG_B)

    expect(forA).toContain('svc-a')
    expect(forA).not.toContain('svc-b')

    expect(forB).toContain('svc-b')
    expect(forB).not.toContain('svc-a')
  })

  it('shows a global row to both of them', async () => {
    expect(await portalNames(ORG_A)).toContain('svc-global')
    expect(await portalNames(ORG_B)).toContain('svc-global')
  })

  it('shows a hidden global row to NOBODY, global or not', async () => {
    // The whole point of a second flag: hidden beats global.
    expect(await portalNames(ORG_A)).not.toContain('svc-global-hidden')
    expect(await portalNames(ORG_B)).not.toContain('svc-global-hidden')
  })

  it('shows a hidden private row to nobody either, including its own client', async () => {
    expect(await portalNames(ORG_A)).not.toContain('svc-a-hidden')
  })

  it('still honours showInCatalog, which is what the ManyRequests import writes 0 into', async () => {
    // The importer lands all 18 source rows unpublished on purpose. Adding
    // `visibility` must not have quietly published them.
    expect(await portalNames(ORG_A)).not.toContain('svc-global-unpublished')
  })

  it('answers exactly the two rows org A is entitled to, and nothing else', async () => {
    expect((await portalNames(ORG_A)).sort()).toEqual(['svc-a', 'svc-global'])
  })
})

// ---------------------------------------------------------------------------
// The admin half: a recorder fake, because the guards are what is under test.
// ---------------------------------------------------------------------------
type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, record: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, key) {
      if (key === 'then') {
        return (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(ok, err)
      }
      if (typeof key !== 'string') return undefined
      return (...args: unknown[]) => {
        record.push({ method: key, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeAdminDb(selectResults: unknown[] = []) {
  const calls: QueryRecord[] = []
  const queue = [...selectResults]
  const entry = (method: string, args: unknown[], result: unknown) => {
    calls.push({ method, args })
    return makeChain(result, calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args, queue.length ? queue.shift() : []),
    insert: (...args: unknown[]) => entry('insert', args, []),
    update: (...args: unknown[]) => entry('update', args, []),
    delete: (...args: unknown[]) => entry('delete', args, []),
  }
  return { handle, calls }
}

const methods = (calls: QueryRecord[]) => calls.map((c) => c.method)

function asAdmin() {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) })

// ---------------------------------------------------------------------------
// POST /api/admin/services
// ---------------------------------------------------------------------------
describe('POST /api/admin/services', () => {
  beforeEach(asAdmin)

  it('400s an orgId that does not name a client, instead of writing an orphan row', async () => {
    const { handle, calls } = makeAdminDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminCreateService(
      jsonReq('/api/admin/services', 'POST', { name: 'Retainer', orgId: 'org-ghost' }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'orgId does not match a client' })
    expect(methods(calls)).not.toContain('insert')
  })

  it('400s an unknown visibility rather than guessing public', async () => {
    const { handle } = makeAdminDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminCreateService(
      jsonReq('/api/admin/services', 'POST', { name: 'Retainer', visibility: 'internal' }),
    )
    expect(res.status).toBe(400)
    // Guessing 'public' on a typo would publish a row the studio meant to hide.
    expect((await res.json() as { error: string }).error).toContain('visibility')
  })

  it('403s a scoped caller creating a row private to a client they cannot see', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
    const { handle, calls } = makeAdminDb([[{ id: ORG_B }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminCreateService(
      jsonReq('/api/admin/services', 'POST', { name: 'Retainer', orgId: ORG_B }),
    )
    expect(res.status).toBe(403)
    expect(methods(calls)).not.toContain('insert')
  })

  it('defaults a row with no orgId to global and public', async () => {
    const { handle, calls } = makeAdminDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminCreateService(
      jsonReq('/api/admin/services', 'POST', { name: 'Website care' }),
    )
    expect(res.status).toBe(201)
    const values = calls.find((c) => c.method === 'values')?.args[0] as Record<string, unknown>
    expect(values.orgId).toBeNull()
    expect(values.visibility).toBe('public')
  })

  it('keeps a private row private, on the column the portal filters by', async () => {
    const { handle, calls } = makeAdminDb([[{ id: ORG_A }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminCreateService(
      jsonReq('/api/admin/services', 'POST', {
        name: 'Acme Custom Retainer', orgId: ORG_A, visibility: 'hidden',
      }),
    )
    expect(res.status).toBe(201)
    const values = calls.find((c) => c.method === 'values')?.args[0] as Record<string, unknown>
    expect(values.orgId).toBe(ORG_A)
    expect(values.visibility).toBe('hidden')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/services/[id]
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/services/[id]', () => {
  beforeEach(asAdmin)

  it('404s a row that does not exist', async () => {
    const { handle } = makeAdminDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-x', 'PATCH', { name: 'New name' }),
      routeParams('svc-x'),
    )
    expect(res.status).toBe(404)
  })

  it("403s a scoped caller editing another client's private row, before any write", async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
    const { handle, calls } = makeAdminDb([[{ id: 'svc-b', orgId: ORG_B }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-b', 'PATCH', { visibility: 'hidden' }),
      routeParams('svc-b'),
    )
    expect(res.status).toBe(403)
    expect(methods(calls)).not.toContain('update')
  })

  it("403s a scoped caller pulling a global row across to a client they cannot see", async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
    const { handle, calls } = makeAdminDb([[{ id: 'svc-global', orgId: null }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-global', 'PATCH', { orgId: ORG_B }),
      routeParams('svc-global'),
    )
    expect(res.status).toBe(403)
    expect(methods(calls)).not.toContain('update')
  })

  it('400s an orgId that does not name a client', async () => {
    const { handle, calls } = makeAdminDb([[{ id: 'svc-global', orgId: null }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-global', 'PATCH', { orgId: 'org-ghost' }),
      routeParams('svc-global'),
    )
    expect(res.status).toBe(400)
    expect(methods(calls)).not.toContain('update')
  })

  it('400s an unknown visibility', async () => {
    const { handle } = makeAdminDb([[{ id: 'svc-global', orgId: null }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-global', 'PATCH', { visibility: 'everyone' }),
      routeParams('svc-global'),
    )
    expect(res.status).toBe(400)
  })

  it('hands a private row back to everyone when orgId is explicitly null', async () => {
    const { handle, calls } = makeAdminDb([[{ id: 'svc-a', orgId: ORG_A }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminUpdateService(
      jsonReq('/api/admin/services/svc-a', 'PATCH', { orgId: null }),
      routeParams('svc-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    const patch = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>
    expect(patch.orgId).toBeNull()
  })

  it('leaves the audience alone when the body never mentions it', async () => {
    const { handle, calls } = makeAdminDb([[{ id: 'svc-a', orgId: ORG_A }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await adminUpdateService(
      jsonReq('/api/admin/services/svc-a', 'PATCH', { name: 'Renamed' }),
      routeParams('svc-a'),
    )
    const patch = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>
    // A missing key must not read as "make this global": that would publish a
    // client's private retainer to everyone on a rename.
    expect(patch).not.toHaveProperty('orgId')
    expect(patch.name).toBe('Renamed')
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/services
// ---------------------------------------------------------------------------
describe('GET /api/admin/services', () => {
  beforeEach(asAdmin)

  it('403s a non-admin caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org-client' } as never)
    const { handle } = makeAdminDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminServices(req('/api/admin/services'))
    expect(res.status).toBe(403)
  })

  it('400s ?orgId= that does not name a client', async () => {
    const { handle } = makeAdminDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminServices(req('/api/admin/services?orgId=org-ghost'))
    expect(res.status).toBe(400)
  })

  it('403s a scoped caller asking for a client they cannot see, before the lookup', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue([ORG_A])
    const { handle, calls } = makeAdminDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminServices(req(`/api/admin/services?orgId=${ORG_B}`))
    expect(res.status).toBe(403)
    // Same 403 whether or not org B is real: not an existence oracle.
    expect(methods(calls)).not.toContain('select')
  })

  it('answers the global catalogue to a caller scoped to no clients at all', async () => {
    // Deny-all is about CLIENT data. The global catalogue is the studio's own,
    // so an empty scope narrows the private rows away rather than the page.
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    const { handle } = makeAdminDb([[{ id: 'svc-global', orgId: null }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await adminServices(req('/api/admin/services'))
    expect(res.status).toBe(200)
    expect((await res.json() as { items: unknown[] }).items).toHaveLength(1)
  })
})
