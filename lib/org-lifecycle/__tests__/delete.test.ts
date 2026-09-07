/**
 * Deleting an organisation outright.
 *
 * This is the one irreversible operation in the pair, and it is deliberately
 * wider than the import cleanup's hard delete (which refuses over a single
 * invoice), so the tests that matter are the REFUSALS: an imported client, a
 * real login, a person who can sign in, a pipeline or sales row, or a real
 * ledger must each come back refused and named, with nothing removed.
 *
 * The happy path then proves the opposite half: children go before parents and
 * the invoices really do go, because a delete that skips a child leaves the
 * orphan rows it claims to prevent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deletedTables, drizzleStub, emptyRecorded, makeFakeDb, type Recorded, type RowStore } from './fake-db'
import { schemaDouble } from './schema-double'

vi.mock('drizzle-orm', () => drizzleStub())
vi.mock('@/db/d1', () => ({ schema: schemaDouble }))

import { PARENT_KEYED_TABLES } from '../refs'
import {
  ClerkOrganisationDeleteFailed,
  OrgDeleteNameMismatch,
  OrgDeleteRefusal,
  OrgNotFoundForDelete,
  runOrgDelete,
} from '../delete'
import type { ClerkExistence, ClerkPresence } from '../delete'
import type { DB } from '@/db/d1'

const ORG = 'dummy-0000-0000-0000-000000000009'
const NAME = 'Acme Widgets Test'

let store: RowStore
let recorded: Recorded

function db(): DB {
  return makeFakeDb(store, recorded) as unknown as DB
}

function seedOrg(over: Record<string, unknown> = {}) {
  store.organisations = [{
    id: ORG,
    name: NAME,
    status: 'active',
    manyrequestsId: null,
    clerkOrgId: null,
    stripeCustomerId: null,
    xeroContactId: null,
    ...over,
  }]
}

beforeEach(() => {
  store = {}
  recorded = emptyRecorded()
})

// ── refusals ─────────────────────────────────────────────────────────────────

describe('delete refusals', () => {
  it('answers not-found for an organisation that is already gone', async () => {
    await expect(runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true }))
      .rejects.toBeInstanceOf(OrgNotFoundForDelete)
  })

  it('refuses a typed name that does not match exactly, before it looks at anything else', async () => {
    seedOrg({ manyrequestsId: '77' })
    const call = runOrgDelete(db(), { orgId: ORG, confirmName: 'acme widgets test', dryRun: true })
    await expect(call).rejects.toBeInstanceOf(OrgDeleteNameMismatch)
    // The message names the expected string and nothing about the org's state.
    await expect(call).rejects.toThrow(/Acme Widgets Test/)
  })

  it('refuses an imported client, because the import only adopts real ones', async () => {
    seedOrg({ manyrequestsId: '77' })
    await expect(runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true }))
      .rejects.toThrow(/ManyRequests id/i)
    expect(recorded.deletes).toEqual([])
  })

  it('refuses an organisation with a Clerk org id, because a real login exists', async () => {
    seedOrg({ clerkOrgId: 'org_2abc' })
    await expect(runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true }))
      .rejects.toThrow(/Clerk organisation id/i)
  })

  it('refuses when any contact can sign in, and names the address', async () => {
    seedOrg()
    store.contacts = [
      { id: 'c1', orgId: ORG, name: 'Real Person', email: 'real@example.com', clerkUserId: 'user_2abc' },
      { id: 'c2', orgId: ORG, name: 'Nobody', email: 'nobody@example.com', clerkUserId: null },
    ]
    await expect(runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true }))
      .rejects.toThrow(/real@example.com/)
  })

  it('does not refuse over a contact whose clerk id is an empty string', async () => {
    seedOrg()
    store.contacts = [{ id: 'c1', orgId: ORG, name: 'Nobody', email: 'nobody@example.com', clerkUserId: '' }]
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    expect(plan.tables.contacts).toBe(1)
  })

  it.each([
    ['deals', 'deals'],
    ['activities', 'activities'],
    ['discovery_calls', 'discovery_calls'],
    ['contracts', 'contracts'],
    ['contract_documents', 'contract_documents'],
    ['proposals', 'proposals'],
    ['project_schedules', 'project_schedules'],
    ['project_calculations', 'project_calculations'],
  ])('refuses over a single %s row and names the table', async (table, named) => {
    seedOrg()
    store[table] = [{ id: `${table}-1`, orgId: ORG }]
    const call = runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    await expect(call).rejects.toBeInstanceOf(OrgDeleteRefusal)
    await expect(call).rejects.toThrow(new RegExp(named))
    expect(recorded.deletes).toEqual([])
  })

  it('refuses over a lead sitting behind a deal on this client', async () => {
    seedOrg()
    store.deals = [{ id: 'deal1', orgId: ORG }]
    store.leads = [{ id: 'lead1', promotedDealId: 'deal1' }]
    await expect(runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true }))
      .rejects.toThrow(/leads \(1\)/)
  })

  it('refuses a real ledger: a paid invoice on a rail plus a Xero contact id', async () => {
    seedOrg({ xeroContactId: 'xero_real' })
    store.invoices = [{ id: 'inv1', orgId: ORG, status: 'paid', xeroInvoiceId: 'xr_1', totalUsd: 900 }]
    const call = runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    await expect(call).rejects.toBeInstanceOf(OrgDeleteRefusal)
    await expect(call).rejects.toThrow(/real ledger/i)
    await expect(call).rejects.toThrow(/Merge/i)
  })

  it('does NOT refuse a paid invoice when the organisation carries no Xero contact', async () => {
    seedOrg({ stripeCustomerId: 'cus_test_1' })
    store.invoices = [{ id: 'inv1', orgId: ORG, status: 'paid', stripeInvoiceId: 'in_test_1', totalUsd: 10 }]
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    expect(plan.invoices).toHaveLength(1)
  })

  it('does NOT refuse over a Stripe customer id alone, but prints it', async () => {
    seedOrg({ stripeCustomerId: 'cus_test_1' })
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    expect(plan.stripeCustomerId).toBe('cus_test_1')
    expect(plan.warnings.join(' ')).toContain('cus_test_1')
  })

  it('refuses the protected QA client and the internal studio marker', async () => {
    const qa = 'd468fd7e-1111-2222-3333-444444444444'
    store.organisations = [{ id: qa, name: NAME, status: 'active', manyrequestsId: null, clerkOrgId: null, stripeCustomerId: null, xeroContactId: null }]
    await expect(runOrgDelete(db(), { orgId: qa, confirmName: NAME, dryRun: true }))
      .rejects.toThrow(/protected/i)
  })
})

// ── dry run ──────────────────────────────────────────────────────────────────

describe('delete dry run', () => {
  it('reports every table holding rows, including the ones keyed on a parent, and writes nothing', async () => {
    seedOrg()
    store.requests = [{ id: 'r1', orgId: ORG }]
    store.request_participants = [{ id: 'rp1', requestId: 'r1' }, { id: 'rp2', requestId: 'r1' }]
    store.subscriptions = [{ id: 's1', orgId: ORG }]
    store.tracks = [{ id: 'tr1', subscriptionId: 's1' }]
    store.invoices = [{ id: 'inv1', orgId: ORG, number: 'INV-1', status: 'draft', totalUsd: 42, currency: 'USD', createdAt: '2026-01-02T00:00:00Z' }]
    store.invoice_items = [{ id: 'ii1', invoiceId: 'inv1' }]

    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })

    expect(plan.tables.requests).toBe(1)
    expect(plan.tables.request_participants).toBe(2)
    expect(plan.tables.subscriptions).toBe(1)
    expect(plan.tables.tracks).toBe(1)
    expect(plan.tables.invoice_items).toBe(1)
    expect(recorded.deletes).toEqual([])
    expect(plan.applied.orgsDeleted).toBe(0)
    expect(store.organisations).toHaveLength(1)
  })

  it('prints every invoice with its rail id, amount and date', async () => {
    seedOrg()
    store.invoices = [
      { id: 'inv1', orgId: ORG, number: 'INV-2026-0001', status: 'paid', totalUsd: 120, currency: 'USD', createdAt: '2026-02-01T00:00:00Z', stripeInvoiceId: 'in_test_1', xeroInvoiceId: null },
    ]
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    expect(plan.invoices[0]).toMatchObject({
      number: 'INV-2026-0001',
      status: 'paid',
      totalUsd: 120,
      currency: 'USD',
      createdAt: '2026-02-01T00:00:00Z',
      stripeInvoiceId: 'in_test_1',
    })
  })

  it('says that the delete is irreversible and that it sends nothing', async () => {
    seedOrg()
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    expect(plan.warnings.join(' ')).toMatch(/irreversible/i)
    expect(plan.warnings.join(' ')).toMatch(/sends email/i)
  })
})

// ── apply ────────────────────────────────────────────────────────────────────

describe('delete apply', () => {
  function seedFullTree() {
    seedOrg()
    store.contacts = [{ id: 'c1', orgId: ORG, name: 'Nobody', email: 'nobody@example.com', clerkUserId: null }]
    store.requests = [{ id: 'r1', orgId: ORG }]
    store.request_participants = [{ id: 'rp1', requestId: 'r1' }]
    store.request_reads = [{ id: 'rr1', requestId: 'r1' }]
    store.request_steps = [{ id: 'rs1', requestId: 'r1' }]
    store.tasks = [{ id: 'tk1', orgId: ORG }]
    store.task_subtasks = [{ id: 'ts1', taskId: 'tk1' }]
    store.conversations = [{ id: 'cv1', orgId: ORG, type: 'org_channel' }]
    store.conversation_participants = [{ id: 'cp1', conversationId: 'cv1' }]
    store.messages = [{ id: 'm1', orgId: ORG }]
    store.message_reactions = [{ id: 'mr1', messageId: 'm1' }]
    store.voice_notes = [{ id: 'vn1', messageId: 'm1' }]
    store.invoices = [{ id: 'inv1', orgId: ORG, status: 'draft', totalUsd: 10, currency: 'USD' }]
    store.invoice_items = [{ id: 'ii1', invoiceId: 'inv1' }]
    store.subscriptions = [{ id: 's1', orgId: ORG }]
    store.tracks = [{ id: 'tr1', subscriptionId: 's1' }]
    store.brands = [{ id: 'br1', orgId: ORG }]
    store.brand_contacts = [{ id: 'bc1', brandId: 'br1', contactId: 'c1' }]
    store.notifications = [{ id: 'n1', userId: 'c1', userType: 'contact' }]
    store.notification_preferences = [{ id: 'np1', userId: 'c1', userType: 'contact' }]
    store.mentions = [{ id: 'mn1', mentionedId: 'c1', mentionedType: 'contact' }]
    store.feature_visibility = [
      { id: 'fv1', subjectType: 'organisation', subjectId: ORG },
      { id: 'fv2', subjectType: 'contact', subjectId: 'c1' },
      { id: 'fv3', subjectType: 'organisation', subjectId: 'someone-else' },
    ]
    store.time_entries = [{ id: 'te1', orgId: ORG }]
    store.files = [{ id: 'f1', orgId: ORG }]
    store.services = [{ id: 'sv1', orgId: ORG }]
    store.case_studies = [{ id: 'cs1', orgId: ORG }]
    store.projects = [{ id: 'pj1', orgId: ORG }]
    store.client_costs = [{ id: 'cc1', orgId: ORG }]
  }

  it('removes every child and then the organisation itself', async () => {
    seedFullTree()
    const plan = await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: false })

    for (const table of Object.keys(store)) {
      if (table === 'feature_visibility') continue
      expect(store[table], `${table} still has rows`).toEqual([])
    }
    expect(plan.applied.orgsDeleted).toBe(1)
    expect(plan.applied.invoicesDeleted).toBe(1)
    expect(plan.applied.rowsDeleted).toBeGreaterThan(20)
  })

  it('takes the invoices and their line items with it, which the import cleanup refuses to do', async () => {
    seedFullTree()
    await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: false })
    expect(store.invoices).toEqual([])
    expect(store.invoice_items).toEqual([])
    expect(store.subscriptions).toEqual([])
    expect(store.tracks).toEqual([])
  })

  it('deletes every parent-keyed child BEFORE its parent, so nothing is orphaned', async () => {
    seedFullTree()
    await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: false })
    const order = deletedTables(recorded)
    for (const entry of PARENT_KEYED_TABLES) {
      const child = order.indexOf(entry.table)
      const parent = order.indexOf(entry.parentTable)
      if (child < 0 || parent < 0) continue
      expect(child, `${entry.table} was deleted after ${entry.parentTable}`).toBeLessThan(parent)
    }
    expect(order[order.length - 1]).toBe('organisations')
  })

  it('removes the portal-visibility rules for this org and its people, and nobody else\'s', async () => {
    seedFullTree()
    await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: false })
    expect(store.feature_visibility.map((row) => row.id)).toEqual(['fv3'])
  })

  it('clears the notifications and preferences that name a contact who is going', async () => {
    seedFullTree()
    await runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: false })
    expect(store.notifications).toEqual([])
    expect(store.notification_preferences).toEqual([])
    expect(store.mentions).toEqual([])
  })
})

// ── the accidental workspace ─────────────────────────────────────────────────
//
// The row self-serve provisioning creates when a Tahi teammate accepts a team
// invite with no active organisation: a Clerk organisation, a D1 organisation
// and a contact carrying the teammate's own login. The ordinary delete refuses
// over exactly those two facts, so this is the one door that opens, and every
// test here is about how narrow it is.

const CLERK_ORG = 'org_3IyX9ULTIjV7H5kdN2rUUOKTGS6'
const STAFF = 'staci@tahi.studio'

function seedAccident(over: Record<string, unknown> = {}) {
  seedOrg({ clerkOrgId: CLERK_ORG, ...over })
  store.contacts = [{ id: 'c1', orgId: ORG, name: 'Staci', email: STAFF, clerkUserId: 'user_staci' }]
  store.team_members = [{ id: 'tm1', name: 'Staci Bonnie', email: 'Staci@Tahi.Studio' }]
}

/**
 * The refusal list, not just its first line: the clerk_org_id refusal is
 * printed first, and the eligibility reasons sit under it.
 */
async function refusalLines(call: Promise<unknown>): Promise<string> {
  try {
    await call
  } catch (error) {
    if (error instanceof OrgDeleteRefusal) return error.refusals.join(' | ')
    throw error
  }
  throw new Error('expected a refusal, got a plan')
}

/** A Clerk deleter that records what it was asked to remove. */
function recordingDeleter(result: 'deleted' | 'already_gone' = 'deleted') {
  const calls: string[] = []
  return {
    calls,
    fn: async (clerkOrgId: string): Promise<'deleted' | 'already_gone'> => {
      calls.push(clerkOrgId)
      return result
    },
  }
}

describe('accidental workspace: eligibility', () => {
  it('reports eligibility, the Clerk org id and the emails on a dry run', async () => {
    seedAccident()
    const plan = await runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    expect(plan.accidentalWorkspace).toMatchObject({
      requested: true,
      eligible: true,
      reasons: [],
      clerkOrgId: CLERK_ORG,
      contactEmails: [STAFF],
      teamEmails: [STAFF],
      clerkResult: null,
    })
    expect(recorded.deletes).toEqual([])
  })

  it('matches the team member address case-insensitively', async () => {
    seedAccident()
    store.contacts = [{ id: 'c1', orgId: ORG, name: 'Staci', email: '  STACI@tahi.studio ', clerkUserId: 'user_staci' }]
    const plan = await runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    expect(plan.accidentalWorkspace.eligible).toBe(true)
  })

  it('assesses the row even when the flag was never passed, so the dialog can offer it', async () => {
    seedAccident()
    const call = runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    await expect(call).rejects.toBeInstanceOf(OrgDeleteRefusal)
    await expect(call).rejects.toMatchObject({
      accidentalWorkspace: { requested: false, eligible: true, clerkOrgId: CLERK_ORG },
    })
  })

  it('refuses the Tahi Studio organisation itself, whatever else is true', async () => {
    const studio = 'org_tahi_studio'
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = studio
    try {
      seedAccident({ clerkOrgId: studio })
      const call = runOrgDelete(db(), {
        orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
      })
      expect(await refusalLines(call)).toMatch(/never deletable/i)
      expect(recorded.deletes).toEqual([])
    } finally {
      delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
    }
  })

  it('refuses a login that does not belong to a team member', async () => {
    seedAccident()
    store.contacts.push({ id: 'c2', orgId: ORG, name: 'A Client', email: 'someone@client.com', clerkUserId: 'user_client' })
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    expect(await refusalLines(call)).toMatch(/someone@client\.com/)
    expect(await refusalLines(call)).toMatch(/do not belong to a Tahi team member/i)
    expect(recorded.deletes).toEqual([])
  })

  it('refuses over a single invoice', async () => {
    seedAccident()
    store.invoices = [{ id: 'inv1', orgId: ORG, status: 'draft', totalUsd: 10, currency: 'USD' }]
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    expect(await refusalLines(call)).toMatch(/holds 1 invoice/i)
  })

  it('refuses over a rail id, which the ordinary delete only prints', async () => {
    seedAccident({ stripeCustomerId: 'cus_test_1' })
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    expect(await refusalLines(call)).toMatch(/paid rail id/i)
  })

  it('refuses over a pipeline row', async () => {
    seedAccident()
    store.deals = [{ id: 'deal1', orgId: ORG }]
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    await expect(call).rejects.toThrow(/deals \(1\)/)
    expect(recorded.deletes).toEqual([])
  })

  it('refuses over a ManyRequests id', async () => {
    seedAccident({ manyrequestsId: '77' })
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true,
    })
    await expect(call).rejects.toThrow(/ManyRequests id/i)
  })
})

describe('accidental workspace: apply', () => {
  it('deletes the Clerk organisation FIRST, then the rows, and reports it', async () => {
    seedAccident()
    const deleter = recordingDeleter()
    let organisationsGoneWhenClerkRan = true
    const watcher = async (clerkOrgId: string): Promise<'deleted' | 'already_gone'> => {
      organisationsGoneWhenClerkRan = (store.organisations ?? []).length === 0
      return deleter.fn(clerkOrgId)
    }
    const plan = await runOrgDelete(db(), {
      orgId: ORG,
      confirmName: NAME,
      dryRun: false,
      removeClerkOrganisation: true,
      deleteClerkOrganisation: watcher,
    })
    expect(deleter.calls).toEqual([CLERK_ORG])
    expect(organisationsGoneWhenClerkRan).toBe(false)
    expect(plan.accidentalWorkspace.clerkResult).toBe('deleted')
    expect(store.organisations).toEqual([])
    expect(store.contacts).toEqual([])
  })

  it('treats a Clerk 404 as already gone and carries on', async () => {
    seedAccident()
    const plan = await runOrgDelete(db(), {
      orgId: ORG,
      confirmName: NAME,
      dryRun: false,
      removeClerkOrganisation: true,
      deleteClerkOrganisation: async () => 'already_gone',
    })
    expect(plan.accidentalWorkspace.clerkResult).toBe('already_gone')
    expect(store.organisations).toEqual([])
  })

  it('aborts with nothing written when Clerk answers anything else', async () => {
    seedAccident()
    const call = runOrgDelete(db(), {
      orgId: ORG,
      confirmName: NAME,
      dryRun: false,
      removeClerkOrganisation: true,
      deleteClerkOrganisation: async () => { throw new Error('clerk 500') },
    })
    await expect(call).rejects.toBeInstanceOf(ClerkOrganisationDeleteFailed)
    expect(recorded.deletes).toEqual([])
    expect(store.organisations).toHaveLength(1)
    expect(store.contacts).toHaveLength(1)
  })

  it('aborts when no deleter was supplied at all, rather than half doing it', async () => {
    seedAccident()
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: false, removeClerkOrganisation: true,
    })
    await expect(call).rejects.toBeInstanceOf(ClerkOrganisationDeleteFailed)
    expect(store.organisations).toHaveLength(1)
  })

  it('writes nothing at all on a dry run, and never calls the deleter', async () => {
    seedAccident()
    const deleter = recordingDeleter()
    await runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, removeClerkOrganisation: true, deleteClerkOrganisation: deleter.fn,
    })
    expect(deleter.calls).toEqual([])
    expect(store.organisations).toHaveLength(1)
  })
})

// ── stale Clerk ids ──────────────────────────────────────────────────────────
//
// The founder can delete the organisation and the user in the Clerk dashboard
// and leave D1 naming a login nobody can use. Refusing over one of those is
// refusing over nothing, so both refusals ask Clerk first. Unreachable keeps
// the refusal: fail closed.

function presence(org: ClerkExistence, user: ClerkExistence): ClerkPresence {
  return { organisationExists: async () => org, userExists: async () => user }
}

describe('stale Clerk ids', () => {
  it('lets the delete through when both the organisation and the user are gone from Clerk', async () => {
    seedAccident()
    const plan = await runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, clerkPresence: presence('gone', 'gone'),
    })
    expect(plan.warnings.join(' ')).toMatch(/no longer exists, id treated as stale/i)
    expect(plan.warnings.join(' ')).toContain(STAFF)
  })

  it('still refuses when the person still exists in Clerk', async () => {
    seedAccident()
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, clerkPresence: presence('gone', 'exists'),
    })
    await expect(call).rejects.toThrow(/can sign in to the portal/i)
  })

  it('still refuses when the organisation still exists in Clerk', async () => {
    seedAccident()
    store.contacts = []
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, clerkPresence: presence('exists', 'gone'),
    })
    await expect(call).rejects.toThrow(/carries a Clerk organisation id/i)
  })

  it('refuses when Clerk cannot be reached, and says so', async () => {
    seedAccident()
    const call = runOrgDelete(db(), {
      orgId: ORG, confirmName: NAME, dryRun: true, clerkPresence: presence('unknown', 'unknown'),
    })
    await expect(call).rejects.toThrow(/could not be reached/i)
    expect(recorded.deletes).toEqual([])
  })

  it('assumes every id is live when no probe is supplied', async () => {
    seedAccident()
    const call = runOrgDelete(db(), { orgId: ORG, confirmName: NAME, dryRun: true })
    await expect(call).rejects.toThrow(/carries a Clerk organisation id/i)
  })
})
