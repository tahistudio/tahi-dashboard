/**
 * THE SNAPSHOT / UPDATABLE CONTRACT.
 *
 * A planner may only update the fields named in its *_UPDATABLE list, and it
 * decides whether to update by comparing those fields against the snapshot.
 * So every updatable field HAS to be one readImportSnapshot actually selects.
 *
 * When it is not, the bug is silent and permanent: `existing[field]` is
 * undefined on every run, `desired[field]` holds the upstream value, sameValue
 * reports a difference, and the row is updated forever. That is what happened
 * to services.description, which SERVICE_UPDATABLE diffed and the select left
 * out. The idempotence test in plan.test.ts cannot see it, because it diffs
 * against projectPlan's projection, which carries the full inserted values
 * rather than the narrower shape the select returns.
 *
 * This asserts the real thing: the column set readImportSnapshot asks D1 for.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, sql: Object.assign(stub, { raw: stub }) }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations' },
    contacts: { __table: 'contacts' },
    teamMembers: { __table: 'team_members' },
    teamMemberRoles: { __table: 'team_member_roles' },
    roles: { __table: 'roles' },
    brands: { __table: 'brands' },
    services: { __table: 'services' },
    subscriptions: { __table: 'subscriptions' },
    requests: { __table: 'requests' },
    messages: { __table: 'messages' },
    invoices: { __table: 'invoices' },
    invoiceItems: { __table: 'invoice_items' },
  },
}))

import { readImportSnapshot } from '../upsert'
import { UPDATABLE_BY_TABLE } from '../plan'
import type { DB } from '@/db/d1'

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

/** Runs readImportSnapshot against a double that records the projections. */
async function selectedColumns(): Promise<Record<string, string[]>> {
  const selected: Record<string, string[]> = {}
  let pending: string[] = []
  const database = {
    all: () => Promise.resolve([{ c: 0 }]),
    select: (projection: Record<string, unknown>) => {
      pending = Object.keys(projection)
      return {
        from: (table: unknown) => {
          selected[tableName(table)] = pending
          return Promise.resolve([])
        },
      }
    },
  } as unknown as DB
  await readImportSnapshot(database)
  return selected
}

describe('readImportSnapshot selects everything the planners diff', () => {
  it('covers every updatable field on every table', async () => {
    const selected = await selectedColumns()
    const gaps: string[] = []
    for (const [table, updatable] of Object.entries(UPDATABLE_BY_TABLE)) {
      const columns = new Set(selected[table] ?? [])
      for (const field of updatable) {
        // manyrequestsId is the key and is always selected; everything else has
        // to be there too or the row is updated on every run for the rest of
        // time without anyone noticing.
        if (!columns.has(field)) gaps.push(`${table}.${field}`)
      }
    }
    expect(gaps).toEqual([])
  })

  it('walks a real set of tables, so an empty pass cannot look clean', async () => {
    const selected = await selectedColumns()
    for (const table of Object.keys(UPDATABLE_BY_TABLE)) {
      expect({ table, selected: (selected[table] ?? []).length > 0 }).toEqual({ table, selected: true })
    }
  })

  it('selects the id of every table it reads, because the diff needs a row to point at', async () => {
    const selected = await selectedColumns()
    for (const [table, columns] of Object.entries(selected)) {
      // team_member_access_orgs-style join tables are not read here; everything
      // this snapshot touches is keyed on an id.
      expect({ table, hasId: columns.includes('id') }).toEqual({ table, hasId: true })
    }
  })
})
