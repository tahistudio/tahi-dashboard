/**
 * The write side.
 *
 * Two properties, both of which the first apply would have failed on:
 *
 *   1. NO STATEMENT EXCEEDS D1's BOUND-PARAMETER CAP. D1 caps bound parameters
 *      at 100 per statement, not at SQLite's 999, and a multi-row insert
 *      multiplies: 20 rows of a 20-column request is roughly 420 parameters and
 *      throws on the first statement of the run. Batches are sized from the
 *      widest row actually being written.
 *   2. A FAILING WRITE IS RECORDED, NOT THROWN. A unique-index collision or a
 *      D1 timeout used to unwind out of runImport: 500, no audit row, and
 *      whatever had already applied stayed applied with no record of it.
 */
import { describe, it, expect, vi } from 'vitest'

const writes: Array<{ table: string; rows: Array<Record<string, unknown>> }> = []
const updates: Array<{ table: string; values: Record<string, unknown> }> = []
let failInsertsFor: string | null = null
let failUpdates = false

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, sql: Object.assign(stub, { raw: stub }) }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id' },
    contacts: { __table: 'contacts', id: 'id' },
    teamMembers: { __table: 'team_members', id: 'id', email: 'email' },
    teamMemberRoles: { __table: 'team_member_roles', id: 'id' },
    roles: { __table: 'roles', id: 'id' },
    brands: { __table: 'brands', id: 'id' },
    services: { __table: 'services', id: 'id' },
    subscriptions: { __table: 'subscriptions', id: 'id' },
    requests: { __table: 'requests', id: 'id' },
    messages: { __table: 'messages', id: 'id' },
    invoices: { __table: 'invoices', id: 'id', manyrequestsId: 'manyrequests_id' },
    invoiceItems: { __table: 'invoice_items', id: 'id' },
  },
}))

import { applyEntityPlan, boundParamsPerRow, insertBatchSize } from '../upsert'
import type { EntityPlan } from '../types'
import type { DB } from '@/db/d1'

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

function fakeDb(): DB {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: (table: unknown) => ({
      values: (rows: Array<Record<string, unknown>>) => {
        if (failInsertsFor === tableName(table)) {
          return Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: messages.manyrequests_id'))
        }
        writes.push({ table: tableName(table), rows })
        return Promise.resolve(undefined)
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (failUpdates) return Promise.reject(new Error('D1_ERROR: network timeout'))
          updates.push({ table: tableName(table), values })
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  } as unknown as DB
}

/** A stand-in Drizzle table whose column map lives on the same symbol shape. */
function tableWithColumns(count: number, withDefaults: number): object {
  const columns: Record<string, unknown> = {}
  for (let index = 0; index < count; index++) {
    columns[`col${index}`] = index < withDefaults ? { default: 0 } : {}
  }
  return { [Symbol('drizzle:Columns')]: columns }
}

function requestPlan(rowCount: number): EntityPlan {
  // Twenty columns, which is what planRequests supplies for a request.
  const values: Record<string, unknown> = {}
  for (let index = 0; index < 20; index++) values[`col${index}`] = `v${index}`
  return {
    entity: 'requests',
    table: 'requests',
    toInsert: Array.from({ length: rowCount }, (_unused, index) => ({
      manyrequestsId: String(index),
      label: `request ${index}`,
      values: { ...values },
    })),
    toUpdate: [],
    toDelete: [],
    unchanged: 0,
    skipped: [],
    unmapped: [],
  }
}

describe('bound-parameter budgeting', () => {
  it('counts a supplied column and an unsupplied column that carries a default', () => {
    // 30 columns, 10 of them with a default. 5 supplied by name (col0..col4,
    // which are inside the default-bearing set), so the cost is the 10
    // default-bearing columns plus nothing else: everything unsupplied without
    // a default is inlined as null and binds nothing.
    const table = tableWithColumns(30, 10)
    const rows = [{ col0: 1, col1: 2, col2: 3, col3: 4, col4: 5 }]
    expect(boundParamsPerRow(table, rows)).toBe(10)
  })

  it('falls back to the widest row when the table carries no column map', () => {
    expect(boundParamsPerRow({}, [{ a: 1, b: 2 }, { a: 1, b: 2, c: 3 }])).toBe(3)
  })

  it('never returns a batch of zero, however wide the row', () => {
    expect(insertBatchSize(500)).toBe(1)
    expect(insertBatchSize(0)).toBe(90)
  })

  it('keeps a requests-shaped batch under the D1 cap', () => {
    const table = tableWithColumns(35, 25)
    const rows = Array.from({ length: 50 }, () => {
      const row: Record<string, unknown> = {}
      for (let index = 0; index < 20; index++) row[`col${index}`] = index
      return row
    })
    const perRow = boundParamsPerRow(table, rows)
    expect(perRow * insertBatchSize(perRow)).toBeLessThanOrEqual(90)
  })
})

describe('applyEntityPlan', () => {
  it('binds no more than 90 values in any single insert, for a requests-shaped row', async () => {
    writes.length = 0
    failInsertsFor = null
    await applyEntityPlan(fakeDb(), requestPlan(100))
    expect(writes.length).toBeGreaterThan(1)
    for (const write of writes) {
      const widest = write.rows.reduce((max, row) => Math.max(max, Object.keys(row).length), 0)
      expect({ table: write.table, bound: write.rows.length * widest <= 90 }).toEqual({
        table: write.table,
        bound: true,
      })
    }
    // And nothing was lost to the batching.
    expect(writes.reduce((total, write) => total + write.rows.length, 0)).toBe(100)
  })

  it('records a failed insert batch and keeps going instead of unwinding the run', async () => {
    writes.length = 0
    failInsertsFor = 'requests'
    const outcome = await applyEntityPlan(fakeDb(), requestPlan(10))
    failInsertsFor = null
    expect(outcome.inserted).toBe(0)
    expect(outcome.failures).toHaveLength(10)
    expect(outcome.failures[0].reason).toContain('UNIQUE constraint failed')
    expect(outcome.failures[0].label).toBe('request 0')
  })

  it('records a failed update with the row it belongs to', async () => {
    updates.length = 0
    failUpdates = true
    const plan = requestPlan(0)
    plan.toUpdate = [{ id: 'req_1', manyrequestsId: '347', label: 'Custom Redirects', changes: { title: 'x' } }]
    const outcome = await applyEntityPlan(fakeDb(), plan)
    failUpdates = false
    expect(outcome.updated).toBe(0)
    expect(outcome.failures[0].label).toBe('Custom Redirects')
    expect(outcome.failures[0].reason).toContain('network timeout')
  })

  it('still refuses a projected dry-run id, which must never reach a write', async () => {
    writes.length = 0
    failInsertsFor = null
    const plan = requestPlan(0)
    plan.toInsert = [{ manyrequestsId: '1', label: 'x', values: { orgId: '__pending:organisations:3' } }]
    const outcome = await applyEntityPlan(fakeDb(), plan)
    expect(outcome.inserted).toBe(0)
    expect(outcome.failures[0].reason).toContain('projected id')
    expect(writes).toEqual([])
  })
})
