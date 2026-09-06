/**
 * The cleanup guards.
 *
 * Hard delete is the one irreversible operation in this slice, and the standing
 * rule is that clients, contacts, invoices and finance data are always real. So
 * the interesting tests here are the REFUSALS: an organisation holding a Xero
 * contact, a Stripe customer, a ManyRequests id or a single invoice must come
 * back refused with a reason, never deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Recorded {
  updates: Array<{ table: string; values: Record<string, unknown> }>
  deletes: string[]
}

const recorded: Recorded = { updates: [], deletes: [] }
let tableRows: Record<string, Array<Record<string, unknown>>> = {}

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, sql: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations' },
    contacts: { __table: 'contacts' },
    requests: { __table: 'requests' },
    messages: { __table: 'messages' },
    timeEntries: { __table: 'time_entries' },
    tasks: { __table: 'tasks' },
    taskSubtasks: { __table: 'task_subtasks' },
    scheduledCalls: { __table: 'scheduled_calls' },
    invoices: { __table: 'invoices' },
    requestParticipants: { __table: 'request_participants' },
    requestReads: { __table: 'request_reads' },
  },
}))

import { runCleanup, matchesDummyAllowlist, isProtectedOrg, isDemoRequestTitle } from '../cleanup'
import type { DB } from '@/db/d1'

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

/** A chainable stand-in for a Drizzle query builder that resolves to rows. */
function query(rows: Array<Record<string, unknown>>) {
  const thenable = {
    where: () => query(rows),
    limit: () => query(rows),
    then: <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(rows).then(resolve),
  }
  return thenable
}

function fakeDb(): DB {
  return {
    select: () => ({ from: (table: unknown) => query(tableRows[tableName(table)] ?? []) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          recorded.updates.push({ table: tableName(table), values })
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        recorded.deletes.push(tableName(table))
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as DB
}

describe('the allowlist itself', () => {
  it('needs BOTH the id prefix and the exact name, because a prefix alone is not a safe key', () => {
    expect(matchesDummyAllowlist({ id: 'd753f180-1111-2222-3333-444444444444', name: 'Acme Corp' })).not.toBeNull()
    expect(matchesDummyAllowlist({ id: 'd753f180-1111-2222-3333-444444444444', name: 'Acme Widgets Test' })).toBeNull()
    expect(matchesDummyAllowlist({ id: 'ea4903bc-1111-2222-3333-444444444444', name: 'Acme Corp' })).toBeNull()
  })

  it('protects the QA client and the internal studio marker', () => {
    expect(isProtectedOrg('org_tahi')).toBe(true)
    expect(isProtectedOrg('d468fd7e-1111-2222-3333-444444444444')).toBe(true)
    expect(isProtectedOrg('ea4903bc-1111-2222-3333-444444444444')).toBe(false)
  })

  it('recognises the self-labelled test titles, including the ones on real clients', () => {
    expect(isDemoRequestTitle('ZZ spine-test request (delete me)')).toBe(true)
    expect(isDemoRequestTitle('dsfsd')).toBe(true)
    expect(isDemoRequestTitle('Test')).toBe(true)
    expect(isDemoRequestTitle('Contact page hours/SLA block + schema')).toBe(false)
  })
})

describe('POST cleanup: hard delete refusals', () => {
  beforeEach(() => {
    recorded.updates = []
    recorded.deletes = []
    tableRows = {}
  })

  const acmeId = 'd753f180-1111-2222-3333-444444444444'

  it('refuses an organisation holding a Xero contact id', async () => {
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived', xeroContactId: 'xero_1', stripeCustomerId: null, manyrequestsId: null }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [acmeId], wipeDemo: false })
    expect(plan.hardDelete).toHaveLength(0)
    expect(plan.refused[0].reason).toContain('Xero contact id')
    expect(recorded.deletes).toEqual([])
  })

  it('refuses an organisation holding a Stripe customer id', async () => {
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived', xeroContactId: null, stripeCustomerId: 'cus_1', manyrequestsId: null }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [acmeId], wipeDemo: false })
    expect(plan.hardDelete).toHaveLength(0)
    expect(plan.refused[0].reason).toContain('Stripe customer id')
    expect(recorded.deletes).toEqual([])
  })

  it('refuses an organisation that holds even one invoice', async () => {
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null }]
    tableRows.invoices = [{ id: 'inv_1' }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [acmeId], wipeDemo: false })
    expect(plan.hardDelete).toHaveLength(0)
    expect(plan.refused[0].reason).toContain('1 invoice(s)')
    expect(plan.refused[0].reason).toContain('re-point them')
    expect(recorded.deletes).toEqual([])
  })

  it('refuses an organisation the import adopted', async () => {
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived', xeroContactId: null, stripeCustomerId: null, manyrequestsId: '3' }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [acmeId], wipeDemo: false })
    expect(plan.refused[0].reason).toContain('ManyRequests id')
    expect(recorded.deletes).toEqual([])
  })

  it('refuses a real client that is simply not on the allowlist', async () => {
    const glasswall = 'ea4903bc-1111-2222-3333-444444444444'
    tableRows.organisations = [{ id: glasswall, name: 'Glasswall Solutions Ltd', status: 'active', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [glasswall], wipeDemo: false })
    expect(plan.refused[0].reason).toContain('Not on the dummy allowlist')
    expect(recorded.deletes).toEqual([])
  })

  it('refuses the protected QA client and the internal marker outright', async () => {
    const qa = 'd468fd7e-1111-2222-3333-444444444444'
    tableRows.organisations = [
      { id: qa, name: 'Tahi Test Client', status: 'active', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null },
      { id: 'org_tahi', name: 'Tahi Studio (internal)', status: 'internal', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null },
    ]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: ['org_tahi'], hardDelete: [qa], wipeDemo: false })
    expect(plan.hardDelete).toHaveLength(0)
    expect(plan.archive).toHaveLength(0)
    expect(plan.refused).toHaveLength(2)
    expect(plan.refused.every((row) => row.reason.includes('Protected organisation'))).toBe(true)
    expect(recorded.deletes).toEqual([])
    expect(recorded.updates).toEqual([])
  })

  it('accepts a clean allowlisted org and reports the blast radius before touching it', async () => {
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null }]
    tableRows.requests = [{ id: 'r1' }, { id: 'r2' }]
    tableRows.contacts = [{ id: 'c1' }]
    const plan = await runCleanup(fakeDb(), { dryRun: true, archive: [], hardDelete: [acmeId], wipeDemo: false })
    expect(plan.hardDelete).toHaveLength(1)
    expect(plan.hardDelete[0].children.requests).toBe(2)
    expect(plan.hardDelete[0].children.contacts).toBe(1)
    // Dry run: reported, not done.
    expect(recorded.deletes).toEqual([])
    expect(plan.applied).toEqual({ archived: 0, orgsDeleted: 0, rowsDeleted: 0 })
  })
})

describe('POST cleanup: dry run writes nothing', () => {
  beforeEach(() => {
    recorded.updates = []
    recorded.deletes = []
    tableRows = {}
  })

  it('plans an archive without performing it', async () => {
    const id = 'ea4903bc-1111-2222-3333-444444444444'
    tableRows.organisations = [{ id, name: 'Glasswall Solutions Ltd', status: 'active', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null }]
    const plan = await runCleanup(fakeDb(), { dryRun: true, archive: [id], hardDelete: [], wipeDemo: false })
    expect(plan.archive).toHaveLength(1)
    expect(recorded.updates).toEqual([])
    expect(plan.applied.archived).toBe(0)
  })

  it('plans the demo wipe without performing it, and never touches discovery calls', async () => {
    const acmeId = 'd753f180-1111-2222-3333-444444444444'
    tableRows.organisations = [{ id: acmeId, name: 'Acme Corp', status: 'archived' }]
    tableRows.requests = [
      { id: 'r_seed', orgId: acmeId, title: 'fgfdh', manyrequestsId: null },
      { id: 'r_imported', orgId: acmeId, title: 'Custom Redirects', manyrequestsId: '347' },
      { id: 'r_orphan', orgId: 'org_that_does_not_exist', title: 'Real looking title', manyrequestsId: null },
    ]
    const plan = await runCleanup(fakeDb(), { dryRun: true, archive: [], hardDelete: [], wipeDemo: true })
    const ids = plan.wipeDemo?.requests.map((row) => row.id) ?? []
    expect(ids).toContain('r_seed')
    expect(ids).toContain('r_orphan')
    // An imported request is never in scope, whatever org it sits on.
    expect(ids).not.toContain('r_imported')
    expect(recorded.deletes).toEqual([])
    expect(plan.warnings.join(' ')).toContain('discovery_calls is never touched')
  })

  it('does perform the archive when the caller says dryRun false', async () => {
    const id = 'ea4903bc-1111-2222-3333-444444444444'
    tableRows.organisations = [{ id, name: 'Glasswall Solutions Ltd', status: 'active', xeroContactId: null, stripeCustomerId: null, manyrequestsId: null }]
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [id], hardDelete: [], wipeDemo: false })
    expect(plan.applied.archived).toBe(1)
    expect(recorded.updates).toEqual([{ table: 'organisations', values: expect.objectContaining({ status: 'archived' }) }])
  })
})
