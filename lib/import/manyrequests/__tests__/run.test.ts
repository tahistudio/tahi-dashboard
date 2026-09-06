/**
 * The orchestrator, end to end against a fake ManyRequests API and a fake D1.
 *
 * The property this file exists for: A DRY RUN PERFORMS NO WRITE. Not "no
 * write to the tables we remembered to check" but no insert, no update and no
 * delete at all, asserted on the database handle itself. The apply path is run
 * against the same fixtures so the two are known to differ only in the write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Writes {
  inserts: Array<{ table: string; rows: Array<Record<string, unknown>> }>
  updates: Array<{ table: string; values: Record<string, unknown> }>
  deletes: string[]
}

const writes: Writes = { inserts: [], updates: [], deletes: [] }

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, sql: Object.assign(stub, { raw: stub }) }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id', email: 'email', manyrequestsId: 'manyrequests_id' },
    contacts: { __table: 'contacts', id: 'id' },
    teamMembers: { __table: 'team_members', id: 'id', email: 'email' },
    teamMemberRoles: { __table: 'team_member_roles', id: 'id' },
    roles: { __table: 'roles', id: 'id', name: 'name' },
    brands: { __table: 'brands', id: 'id' },
    services: { __table: 'services', id: 'id' },
    subscriptions: { __table: 'subscriptions', id: 'id' },
    requests: { __table: 'requests', id: 'id' },
    messages: { __table: 'messages', id: 'id' },
    invoices: { __table: 'invoices', id: 'id', manyrequestsId: 'manyrequests_id' },
    invoiceItems: { __table: 'invoice_items', id: 'id' },
  },
}))

import { runImport } from '../run'
import type { ManyRequestsClient } from '../client'
import type { DB } from '@/db/d1'

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

let rows: Record<string, Array<Record<string, unknown>>> = {}

function query(result: Array<Record<string, unknown>>) {
  const chain = {
    where: () => query(result),
    limit: () => query(result),
    then: <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(result).then(resolve),
  }
  return chain
}

function fakeDb(): DB {
  return {
    all: () => Promise.resolve([{ c: 0 }]),
    select: () => ({ from: (table: unknown) => query(rows[tableName(table)] ?? []) }),
    insert: (table: unknown) => ({
      values: (values: Array<Record<string, unknown>>) => {
        writes.inserts.push({ table: tableName(table), rows: values })
        return Promise.resolve(undefined)
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          writes.updates.push({ table: tableName(table), values })
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        writes.deletes.push(tableName(table))
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as DB
}

function fakeClient(): ManyRequestsClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    listAll: vi.fn().mockResolvedValue([]),
    listOrganizations: vi.fn().mockResolvedValue([
      {
        id: 18,
        name: 'Blank Space Inc',
        owner: { id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca' },
        created_at: '2024-02-01T00:00:00Z',
        subscription_status: 'unsubscribed',
        balance: { hours: -6.57 },
      },
    ]),
    listOrgMembers: vi.fn().mockResolvedValue([
      { id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', is_owner: true },
    ]),
    listOrgBrands: vi.fn().mockResolvedValue([]),
    listOrgServices: vi.fn().mockResolvedValue([]),
    listClients: vi.fn().mockResolvedValue([]),
    listServices: vi.fn().mockResolvedValue([]),
    listInvoices: vi.fn().mockResolvedValue([]),
    getInvoice: vi.fn().mockResolvedValue({ number: 'INV-1' }),
    listRequests: vi.fn().mockResolvedValue([]),
    getRequest: vi.fn().mockResolvedValue({ id: 1 }),
  } as unknown as ManyRequestsClient
}

describe('runImport', () => {
  beforeEach(() => {
    writes.inserts = []
    writes.updates = []
    writes.deletes = []
    rows = { roles: [{ id: 'role-super-admin', name: 'super_admin' }, { id: 'role-task-handler', name: 'task_handler' }] }
  })

  it('a dry run performs NO insert, NO update and NO delete, on any table', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: true,
      entities: ['team', 'organisations', 'contacts', 'brands', 'services', 'subscriptions', 'requests', 'messages', 'invoices'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })

    expect(writes.inserts).toEqual([])
    expect(writes.updates).toEqual([])
    expect(writes.deletes).toEqual([])
    expect(result.dryRun).toBe(true)
    // A dry run that plans nothing would pass the assertions above vacuously.
    const planned = result.entities.reduce((total, entity) => total + entity.toInsert + entity.toUpdate, 0)
    expect(planned).toBeGreaterThan(0)
    for (const entity of result.entities) {
      expect({ entity: entity.entity, inserted: entity.inserted }).toEqual({ entity: entity.entity, inserted: 0 })
      expect({ entity: entity.entity, updated: entity.updated }).toEqual({ entity: entity.entity, updated: 0 })
    }
  })

  it('returns the first 20 sample rows and the refusals with their reasons', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: true,
      entities: ['organisations', 'contacts'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    expect(result.samples.organisations.length).toBeGreaterThan(0)
    expect(result.samples.organisations.length).toBeLessThanOrEqual(20)
    expect(result.skipped.organisations).toBeDefined()
    expect(result.unmapped.organisations.length).toBeGreaterThan(0)
  })

  it('reads the mail probe before AND after, and reports agreement', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: true,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    expect(result.mailProbeBefore).toEqual(result.mailProbeAfter)
    expect(result.mailSilent).toBe(true)
  })

  it('an apply DOES write, so the dry run assertion above is not passing by accident', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: false,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    expect(writes.inserts.length).toBeGreaterThan(0)
    expect(writes.inserts[0].table).toBe('organisations')
    expect(writes.inserts[0].rows[0].name).toBe('Blank Space Inc')
    // An imported organisation never carries a Clerk workspace.
    expect(writes.inserts[0].rows[0].clerkOrgId).toBeNull()
    expect(result.entities[0].inserted).toBe(1)
  })

  it('turns a ManyRequests read failure into a warning instead of losing the whole run', async () => {
    const client = fakeClient()
    ;(client.listOrganizations as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('ManyRequests GET /organizations returned 401'),
    )
    const result = await runImport({
      database: fakeDb(),
      client,
      dryRun: true,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    expect(result.warnings.join(' ')).toContain('401')
    expect(result.entities[0].toInsert).toBe(0)
  })

  it('runs only the entities it was asked for', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: true,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    expect(result.entities.map((entity) => entity.entity)).toEqual(['organisations'])
  })

  it('walks the request detail list in a WINDOW, not just from the front', async () => {
    // Without an offset the apply had to succeed in one shot: there was no way
    // to reach requests 200 to 329 without re-fetching the first 200, and 329
    // sequential upstream GETs does not fit the edge request budget.
    const client = fakeClient()
    const list = Array.from({ length: 10 }, (_unused, index) => ({ id: index + 1, title: `r${index + 1}` }))
    ;(client.listRequests as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(list)
    const detail = vi.fn((id: string) => Promise.resolve({ id: Number(id) }))
    ;(client as unknown as { getRequest: unknown }).getRequest = detail

    const result = await runImport({
      database: fakeDb(),
      client,
      dryRun: true,
      entities: ['requests'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
      requestDetailOffset: 4,
      requestDetailLimit: 3,
    })

    expect(detail.mock.calls.map((call) => call[0])).toEqual(['5', '6', '7'])
    expect(result.warnings.join(' ')).toContain('requestDetailOffset 7')
  })

  it('returns a PARTIAL result when an entity throws, instead of losing the whole run', async () => {
    // The route writes the audit row off this result, so an apply that died
    // halfway has to come back reportable rather than as an exception.
    let reads = 0
    const database = fakeDb() as unknown as { select: () => unknown }
    const original = database.select
    database.select = () => {
      reads += 1
      // Fail the snapshot re-read that happens after the first applied entity.
      if (reads > 40) throw new Error('D1_ERROR: network connection lost')
      return (original as () => unknown)()
    }

    const result = await runImport({
      database: database as unknown as DB,
      client: fakeClient(),
      dryRun: false,
      entities: ['team', 'organisations', 'contacts', 'brands', 'services', 'subscriptions', 'requests', 'messages', 'invoices'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })

    expect(result.warnings.join(' ')).toContain('network connection lost')
    expect(result.warnings.join(' ')).toContain('re-running resumes rather than duplicates')
    // Something landed, and it is in the counts the audit row records.
    expect(result.entities.length).toBeGreaterThan(0)
  })

  it('says which mail witnesses were live, so mailSilent is not read as two when it is one', async () => {
    const result = await runImport({
      database: fakeDb(),
      client: fakeClient(),
      dryRun: true,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })
    // The double answers every count query, so both probes are live here.
    expect(result.mailWitnesses.notifications).toBe('live')
    expect(result.mailWitnesses.degraded).toBe(false)
  })
})
