/**
 * The orchestrator over a SNAPSHOT client, end to end against a fake D1.
 *
 * run.test.ts proves the run against a mocked live client. This proves the
 * same run reads a pre-fetched snapshot through createSnapshotClient and
 * plans real inserts from it, with the same dry-run guarantee: no insert, no
 * update and no delete on any table.
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
import { createSnapshotClient, validateSnapshotPayload, type ManyRequestsSnapshotPayload } from '../snapshot-client'
import { IMPORT_ENTITY_ORDER } from '../types'
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

/**
 * The same client as run.test.ts's fixture (Blank Space Inc, org 18, not in
 * the hand-made name map so it is a clean insert), carried through every list
 * the way the MCP assembler would deliver it.
 */
function snapshot(): ManyRequestsSnapshotPayload {
  return {
    organizations: [
      {
        id: 18,
        name: 'Blank Space Inc',
        owner: { id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca' },
        created_at: '2024-02-01T00:00:00Z',
        subscription_status: 'unsubscribed',
        balance: { hours: -6.57, purchased_hours: 10 },
      },
    ],
    membersByOrg: {
      '18': [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', is_owner: true, created_at: '2024-02-01T00:00:00Z' }],
    },
    brandsByOrg: { '18': [{ id: 7, name: 'Blank Space' }] },
    subscriptionsByOrg: {
      '18': [
        {
          service: { id: 5, name: 'Blank Space Retainer' },
          status: 'canceled',
          billing_period: 'Monthly',
          member: { name: 'Saif Al-Janabi' },
          hours_per_period: 10,
          created_at: '2024-02-05T00:00:00Z',
        },
      ],
    },
    clients: [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', organization: { id: 18, name: 'Blank Space Inc' } }],
    services: [{ id: 5, name: 'Blank Space Retainer', type: 'recurring', currency: 'USD', price: 500, hours: 10 }],
    requests: [
      {
        id: 347,
        number: 347,
        title: 'Custom Redirects',
        status: 'In progress',
        priority: 'high',
        organization: { id: 18, name: 'Blank Space Inc' },
        client: { id: 40, name: 'Saif Al-Janabi' },
        assignees: ['Liam Miller'],
        created_at: '2026-08-01T00:00:00Z',
        due_date: '2026-09-30',
        fields: [{ label: 'Description and supporting links/information', type: 'textarea', value: 'Redirect map attached' }],
        comments: [{ author: 'Nathan Day', content: 'On it today', is_internal: false, created_at: '2026-08-02T00:00:00Z' }],
        comments_total: 1,
      },
      {
        id: 348,
        number: 348,
        title: 'Footer fix',
        status: 'Submitted',
        organization: { id: 18, name: 'Blank Space Inc' },
        created_at: '2026-08-05T00:00:00Z',
      },
      {
        id: 349,
        number: 349,
        title: 'Hero copy',
        status: 'Submitted',
        organization: { id: 18, name: 'Blank Space Inc' },
        created_at: '2026-08-06T00:00:00Z',
      },
    ],
    invoices: [
      {
        number: 'INV-2025000024',
        status: 'pending',
        amount: 1279.67,
        subtotal: 1150,
        currency: 'USD',
        created_at: '2025-12-27T00:00:00Z',
        organization: { id: 18, name: 'Blank Space Inc' },
        line_items: [
          { name: 'Webflow services', quantity: 1, unit_price: 1150, subtotal: 1150 },
          { name: 'Late Fee', quantity: 1, unit_price: 129.67, subtotal: 129.67 },
        ],
      },
    ],
  }
}

function countsByEntity(result: Awaited<ReturnType<typeof runImport>>): Record<string, number> {
  return Object.fromEntries(result.entities.map((entity) => [entity.entity, entity.toInsert]))
}

describe('runImport over a snapshot client', () => {
  beforeEach(() => {
    writes.inserts = []
    writes.updates = []
    writes.deletes = []
    rows = { roles: [{ id: 'role-super-admin', name: 'super_admin' }, { id: 'role-task-handler', name: 'task_handler' }] }
  })

  it('plans the expected inserts from the snapshot, in a dry run that writes nothing', async () => {
    const checked = validateSnapshotPayload(snapshot())
    expect(checked.ok).toBe(true)
    if (!checked.ok) return

    const result = await runImport({
      database: fakeDb(),
      client: createSnapshotClient(checked.snapshot),
      dryRun: true,
      entities: [...IMPORT_ENTITY_ORDER],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })

    expect(writes.inserts).toEqual([])
    expect(writes.updates).toEqual([])
    expect(writes.deletes).toEqual([])
    expect(result.dryRun).toBe(true)

    // No read failed: the snapshot answered every list and every detail read.
    expect(result.warnings.filter((warning) => warning.includes('returned'))).toEqual([])

    const planned = countsByEntity(result)
    expect(planned.organisations).toBe(1)
    expect(planned.contacts).toBe(1)
    expect(planned.brands).toBe(1)
    expect(planned.services).toBe(1)
    expect(planned.subscriptions).toBe(1)
    expect(planned.requests).toBe(3)
    expect(planned.messages).toBe(1)
    // The invoice plus its two line items.
    expect(planned.invoices).toBe(3)

    // The brief and the intake answers came through the detail read, which
    // is the first thing the route doc says to check on a live dry run.
    const request = result.samples.requests[0] as { values: Record<string, unknown> }
    expect(request.values.description).toContain('Redirect map attached')
    const org = result.samples.organisations[0] as { values: Record<string, unknown> }
    expect(org.values.name).toBe('Blank Space Inc')
    expect(org.values.clerkOrgId).toBeNull()
  })

  it('still honours the request detail window, so a walked run behaves the same on a snapshot', async () => {
    const checked = validateSnapshotPayload(snapshot())
    if (!checked.ok) throw new Error(checked.reason)

    const result = await runImport({
      database: fakeDb(),
      client: createSnapshotClient(checked.snapshot),
      dryRun: true,
      entities: ['organisations', 'requests'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
      requestDetailOffset: 1,
      requestDetailLimit: 1,
    })

    expect(countsByEntity(result).requests).toBe(1)
    const request = result.samples.requests[0] as { label: string }
    expect(request.label).toBe('Footer fix')
    expect(result.warnings.join(' ')).toContain('requestDetailOffset 2')
  })

  it('falls back to the list row with a warning when a detail read misses, exactly like the live client', async () => {
    const checked = validateSnapshotPayload(snapshot())
    if (!checked.ok) throw new Error(checked.reason)
    const client = createSnapshotClient(checked.snapshot)
    // A client whose list carries a row its detail lookup cannot find.
    const original = client.listRequests
    client.listRequests = async () => [...(await original()), { id: 999, title: 'Ghost', status: 'Submitted', organization: { id: 18, name: 'Blank Space Inc' } }]

    const result = await runImport({
      database: fakeDb(),
      client,
      dryRun: true,
      entities: ['organisations', 'requests'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })

    expect(result.warnings.join(' ')).toContain('request 999')
    expect(result.warnings.join(' ')).toContain('not in snapshot')
    // The ghost still imports its title and status from the list row.
    expect(countsByEntity(result).requests).toBe(4)
  })

  it('an apply DOES write from the snapshot, so the dry run assertion is not passing by accident', async () => {
    const checked = validateSnapshotPayload(snapshot())
    if (!checked.ok) throw new Error(checked.reason)

    const result = await runImport({
      database: fakeDb(),
      client: createSnapshotClient(checked.snapshot),
      dryRun: false,
      entities: ['organisations'],
      since: null,
      closedAs: 'cancelled',
      now: '2026-09-07T00:00:00.000Z',
    })

    expect(writes.inserts.length).toBeGreaterThan(0)
    expect(writes.inserts[0].table).toBe('organisations')
    expect(writes.inserts[0].rows[0].name).toBe('Blank Space Inc')
    expect(result.entities[0].inserted).toBe(1)
  })
})
