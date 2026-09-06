/**
 * Merging one organisation into another.
 *
 * The interesting cases are the ones that would quietly lose data: an external
 * id overwritten, an org-scoped table left pointing at a row that no longer
 * exists, a folded contact whose history stays behind on the duplicate that
 * was just deleted. Each of those is pinned here, column by column, against a
 * double that really filters and really mutates (see fake-db.ts), so the
 * assertions are on where the rows ended up rather than on which calls were
 * made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { drizzleStub, emptyRecorded, makeFakeDb, type Recorded, type RowStore } from './fake-db'
import { schemaDouble } from './schema-double'

vi.mock('drizzle-orm', () => drizzleStub())
vi.mock('@/db/d1', () => ({ schema: schemaDouble }))

import { CONTACT_REFERENCE_COLUMNS, ORG_SCOPED_TABLES } from '../refs'
import { OrgMergeRefusal, OrgNotFound, runOrgMerge } from '../merge'
import type { DB } from '@/db/d1'

const SHELL = 'shell-0000-0000-0000-000000000001'
const SURVIVOR = 'surv0-0000-0000-0000-000000000002'

let store: RowStore
let recorded: Recorded

function db(): DB {
  return makeFakeDb(store, recorded) as unknown as DB
}

function org(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id === SHELL ? 'Charles Bilash (DUPLICATE, do not use)' : 'Charles Bilash',
    status: 'active',
    website: null,
    industry: null,
    accentColour: null,
    planType: 'none',
    internalNotes: null,
    xeroContactId: null,
    stripeCustomerId: null,
    manyrequestsId: null,
    clerkOrgId: null,
    ...over,
  }
}

function seedPair(shellOver: Record<string, unknown> = {}, survivorOver: Record<string, unknown> = {}) {
  store.organisations = [org(SHELL, shellOver), org(SURVIVOR, survivorOver)]
}

beforeEach(() => {
  store = {}
  recorded = emptyRecorded()
})

// ── refusals ─────────────────────────────────────────────────────────────────

describe('merge refusals', () => {
  it('refuses merging an organisation into itself', async () => {
    seedPair()
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SHELL, dryRun: true }))
      .rejects.toThrow(/cannot be merged into itself/i)
  })

  it('answers not-found for a shell that has already been merged away', async () => {
    store.organisations = [org(SURVIVOR)]
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true }))
      .rejects.toBeInstanceOf(OrgNotFound)
  })

  it('refuses a survivor that does not exist', async () => {
    store.organisations = [org(SHELL)]
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true }))
      .rejects.toThrow(/No organisation with that id to merge into/i)
  })

  it('refuses an archived survivor, because the moved rows would be hidden', async () => {
    seedPair({}, { status: 'archived' })
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true }))
      .rejects.toThrow(/archived/i)
  })

  it('refuses to merge away a protected organisation', async () => {
    const qa = 'd468fd7e-1111-2222-3333-444444444444'
    store.organisations = [org(qa), org(SURVIVOR)]
    await expect(runOrgMerge(db(), { shellId: qa, survivorId: SURVIVOR, dryRun: true }))
      .rejects.toThrow(/protected/i)
  })

  it.each([
    ['xeroContactId', 'xero_contact_id', 'xero_shell', 'xero_surv'],
    ['stripeCustomerId', 'stripe_customer_id', 'cus_shell', 'cus_surv'],
    ['manyrequestsId', 'manyrequests_id', '11', '22'],
    ['clerkOrgId', 'clerk_org_id', 'org_shell', 'org_surv'],
  ])('refuses and names %s when both sides hold a DIFFERENT value', async (key, column, shellValue, survivorValue) => {
    seedPair({ [key]: shellValue }, { [key]: survivorValue })
    store.requests = [{ id: 'r1', orgId: SHELL }]

    // The refusal fires in both modes, so an apply cannot slip past a dry run
    // that was never read.
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false }))
      .rejects.toBeInstanceOf(OrgMergeRefusal)
    await expect(runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false }))
      .rejects.toThrow(new RegExp(column))

    expect(recorded.updates).toEqual([])
    expect(recorded.deletes).toEqual([])
    expect(store.requests[0].orgId).toBe(SHELL)
  })

  it('does not refuse when both sides hold the SAME external id', async () => {
    seedPair({ xeroContactId: 'xero_same' }, { xeroContactId: 'xero_same' })
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    const entry = plan.externalIds.find((row) => row.field === 'xero_contact_id')
    expect(entry?.carried).toBe(false)
    expect(entry?.note).toMatch(/already holds the same value/i)
  })
})

// ── dry run ──────────────────────────────────────────────────────────────────

describe('merge dry run', () => {
  it('counts every org-scoped table that holds a row, and writes nothing', async () => {
    seedPair()
    store.requests = [{ id: 'r1', orgId: SHELL }, { id: 'r2', orgId: SHELL }, { id: 'r3', orgId: SURVIVOR }]
    store.invoices = [{ id: 'inv1', orgId: SHELL }]
    store.time_entries = [{ id: 't1', orgId: SHELL }, { id: 't2', orgId: SHELL }, { id: 't3', orgId: SHELL }]
    store.brands = [{ id: 'b1', orgId: SURVIVOR }]

    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })

    expect(plan.tables.requests).toBe(2)
    expect(plan.tables.invoices).toBe(1)
    expect(plan.tables.time_entries).toBe(3)
    // A table that only the SURVIVOR has rows in is not part of the move.
    expect(plan.tables.brands).toBeUndefined()
    expect(recorded.updates).toEqual([])
    expect(recorded.deletes).toEqual([])
    expect(plan.applied.orgsRemoved).toBe(0)
    expect(store.requests.filter((row) => row.orgId === SHELL)).toHaveLength(2)
  })

  it('carries an external id only into an EMPTY field, and names it', async () => {
    // The shell holds a Xero contact the survivor lacks (carried), and the
    // survivor holds a Stripe customer the shell lacks (left alone).
    seedPair({ xeroContactId: 'xero_real' }, { stripeCustomerId: 'cus_already_here' })
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    expect(plan.externalIds.find((row) => row.field === 'xero_contact_id')).toMatchObject({ carried: true, shellValue: 'xero_real' })
    expect(plan.externalIds.find((row) => row.field === 'stripe_customer_id')?.carried).toBe(false)
  })

  it('lists the organisation columns the survivor would take from the shell', async () => {
    seedPair(
      { website: 'https://real.example', industry: 'Health', planType: 'maintain', internalNotes: 'Bills quarterly.' },
      { website: null, industry: null, planType: 'none', internalNotes: null },
    )
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    expect(plan.columns.map((row) => row.field).sort()).toEqual(['industry', 'internal_notes', 'plan_type', 'website'])
  })

  it('leaves a filled survivor column alone', async () => {
    seedPair(
      { website: 'https://shell.example', planType: 'scale' },
      { website: 'https://survivor.example', planType: 'maintain' },
    )
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    const fields = plan.columns.map((row) => row.field)
    expect(fields).not.toContain('website')
    expect(fields).not.toContain('plan_type')
  })

  it('separates contacts that move from contacts that fold into a matching email', async () => {
    seedPair()
    store.contacts = [
      { id: 'c_shell_dup', orgId: SHELL, name: 'Charles B', email: 'Charles@Example.com' },
      { id: 'c_shell_new', orgId: SHELL, name: 'Ops', email: 'ops@example.com' },
      { id: 'c_surv', orgId: SURVIVOR, name: 'Charles Bilash', email: 'charles@example.com' },
    ]
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    expect(plan.contacts.folded).toEqual([
      { id: 'c_shell_dup', name: 'Charles B', email: 'Charles@Example.com', intoContactId: 'c_surv' },
    ])
    expect(plan.contacts.moved.map((row) => row.id)).toEqual(['c_shell_new'])
  })

  it('warns about request numbers that would collide, rather than renumbering', async () => {
    seedPair()
    store.requests = [
      { id: 'r1', orgId: SHELL, requestNumber: 1 },
      { id: 'r2', orgId: SURVIVOR, requestNumber: 1 },
    ]
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    expect(plan.warnings.join(' ')).toMatch(/request number/i)
  })

  it('always says that a merge sends no email', async () => {
    seedPair()
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
    expect(plan.warnings.join(' ')).toMatch(/sends email/i)
  })
})

// ── apply ────────────────────────────────────────────────────────────────────

describe('merge apply: every org-scoped table', () => {
  it('re-points EVERY table in ORG_SCOPED_TABLES, not the six somebody remembered', async () => {
    seedPair()
    // One row on the shell in every org-scoped table the list names, plus a
    // row on the survivor that must not be touched.
    for (const entry of ORG_SCOPED_TABLES) {
      store[entry.table] = [
        { id: `${entry.table}-shell`, orgId: SHELL },
        { id: `${entry.table}-survivor`, orgId: SURVIVOR },
      ]
    }
    // contacts is special-cased (it folds on email), so give it distinct ones.
    store.contacts = [
      { id: 'contacts-shell', orgId: SHELL, name: 'A', email: 'a@example.com' },
      { id: 'contacts-survivor', orgId: SURVIVOR, name: 'B', email: 'b@example.com' },
    ]
    // team_member_access_orgs is deduplicated on accessId, so the two rows
    // have to belong to different access rules or one is legitimately dropped.
    store.team_member_access_orgs = [
      { id: 'tmao-shell', accessId: 'acc_shell', orgId: SHELL },
      { id: 'tmao-survivor', accessId: 'acc_survivor', orgId: SURVIVOR },
    ]

    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })

    for (const entry of ORG_SCOPED_TABLES) {
      const left = (store[entry.table] ?? []).filter((row) => row.orgId === SHELL)
      expect(left, `${entry.table} still points at the shell`).toEqual([])
      expect((store[entry.table] ?? []).length, `${entry.table} lost a row`).toBe(2)
    }
    expect(plan.applied.orgsRemoved).toBe(1)
    expect(store.organisations.map((row) => row.id)).toEqual([SURVIVOR])
  })

  it('does not touch a table the shell has no rows in', async () => {
    seedPair()
    store.requests = [{ id: 'r1', orgId: SHELL }]
    store.deals = [{ id: 'd1', orgId: SURVIVOR }]
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    expect(recorded.updates.map((row) => row.table)).not.toContain('deals')
  })

  it('carries the shell external ids onto the survivor AFTER the shell row is gone', async () => {
    seedPair({ xeroContactId: 'xero_real', clerkOrgId: 'org_clerk', manyrequestsId: '404' }, {})
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })

    const survivor = store.organisations.find((row) => row.id === SURVIVOR)
    expect(survivor).toMatchObject({ xeroContactId: 'xero_real', clerkOrgId: 'org_clerk', manyrequestsId: '404' })

    // clerk_org_id and manyrequests_id are UNIQUE indexes, so writing them onto
    // the survivor while the shell still held them would abort the statement.
    const deleteAt = recorded.events.findIndex((row) => row.kind === 'delete' && row.table === 'organisations')
    const writeAt = recorded.events.findIndex(
      (row) => row.kind === 'update' && row.table === 'organisations' && row.values !== undefined && 'clerkOrgId' in row.values,
    )
    expect(deleteAt).toBeGreaterThanOrEqual(0)
    expect(writeAt).toBeGreaterThanOrEqual(0)
    expect(deleteAt).toBeLessThan(writeAt)
  })

  it('fills the survivor columns and appends the shell notes under a heading', async () => {
    seedPair({ internalNotes: 'Pays late.', industry: 'Health' }, { internalNotes: 'Prefers Loom.' })
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    const survivor = store.organisations.find((row) => row.id === SURVIVOR)
    expect(String(survivor?.internalNotes)).toContain('Prefers Loom.')
    expect(String(survivor?.internalNotes)).toContain('Merged from')
    expect(String(survivor?.internalNotes)).toContain('Pays late.')
    expect(survivor?.industry).toBe('Health')
  })

  it('removes the shell organisation portal-visibility rules rather than carrying them', async () => {
    seedPair()
    store.feature_visibility = [
      { id: 'fv1', subjectType: 'organisation', subjectId: SHELL },
      { id: 'fv2', subjectType: 'organisation', subjectId: SURVIVOR },
    ]
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    expect(store.feature_visibility.map((row) => row.id)).toEqual(['fv2'])
  })
})

// ── contacts ─────────────────────────────────────────────────────────────────

describe('merge apply: contacts and their references', () => {
  const DUP = 'c_shell_dup'
  const KEEP = 'c_survivor'

  function seedContactWorld() {
    seedPair()
    store.contacts = [
      { id: DUP, orgId: SHELL, name: 'Charles B', email: 'CHARLES@example.com ' },
      { id: KEEP, orgId: SURVIVOR, name: 'Charles Bilash', email: 'charles@example.com' },
      { id: 'c_only_here', orgId: SHELL, name: 'Ops', email: 'ops@example.com' },
    ]
    store.requests = [{ id: 'r1', orgId: SHELL, submittedById: DUP, submittedByType: 'contact' }]
    store.request_participants = [
      { id: 'rp1', requestId: 'r1', participantId: DUP, participantType: 'contact', addedById: DUP, addedByType: 'contact' },
    ]
    store.request_reads = [{ id: 'rr1', requestId: 'r1', userId: DUP, userType: 'contact' }]
    store.request_steps = [{ id: 'rs1', requestId: 'r1', createdById: DUP, createdByType: 'contact' }]
    store.conversation_participants = [{ id: 'cp1', conversationId: 'cv_survivor', participantId: DUP, participantType: 'contact' }]
    store.messages = [{ id: 'm1', orgId: SHELL, authorId: DUP, authorType: 'contact', conversationId: null }]
    store.files = [{ id: 'f1', orgId: SHELL, uploadedById: DUP, uploadedByType: 'contact' }]
    store.tasks = [{ id: 'tk1', orgId: SHELL, assigneeId: DUP, assigneeType: 'contact' }]
    store.mentions = [{ id: 'mn1', mentionedId: DUP, mentionedType: 'contact' }]
    store.notifications = [{ id: 'n1', userId: DUP, userType: 'contact' }]
    store.notification_preferences = [{ id: 'np1', userId: DUP, userType: 'contact' }]
    store.subscriptions = [{ id: 's1', orgId: SHELL, billedContactId: DUP }]
    store.deal_contacts = [{ id: 'dc1', contactId: DUP }]
    store.activities = [{ id: 'ac1', orgId: SHELL, contactId: DUP }]
    store.brand_contacts = [{ id: 'bc1', brandId: 'br1', contactId: DUP }]
  }

  it('re-points every contact-referencing column onto the surviving person', async () => {
    seedContactWorld()
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })

    expect(store.requests[0].submittedById).toBe(KEEP)
    expect(store.request_participants[0].participantId).toBe(KEEP)
    expect(store.request_participants[0].addedById).toBe(KEEP)
    expect(store.request_reads[0].userId).toBe(KEEP)
    expect(store.request_steps[0].createdById).toBe(KEEP)
    expect(store.conversation_participants[0].participantId).toBe(KEEP)
    expect(store.messages[0].authorId).toBe(KEEP)
    expect(store.files[0].uploadedById).toBe(KEEP)
    expect(store.tasks[0].assigneeId).toBe(KEEP)
    expect(store.mentions[0].mentionedId).toBe(KEEP)
    expect(store.notifications[0].userId).toBe(KEEP)
    expect(store.notification_preferences[0].userId).toBe(KEEP)
    expect(store.subscriptions[0].billedContactId).toBe(KEEP)
    expect(store.deal_contacts[0].contactId).toBe(KEEP)
    expect(store.activities[0].contactId).toBe(KEEP)
    expect(store.brand_contacts[0].contactId).toBe(KEEP)
  })

  it('covers every column CONTACT_REFERENCE_COLUMNS names, so a new one cannot be missed', async () => {
    seedContactWorld()
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    for (const entry of CONTACT_REFERENCE_COLUMNS) {
      const rows = store[entry.table] ?? []
      const stragglers = rows.filter((row) => row[entry.column] === DUP)
      expect(stragglers, `${entry.table}.${entry.sqlColumn} still points at the deleted duplicate`).toEqual([])
    }
  })

  it('deletes the duplicate contact and moves the one with no match', async () => {
    seedContactWorld()
    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    expect(store.contacts.map((row) => row.id).sort()).toEqual(['c_only_here', KEEP])
    expect(store.contacts.find((row) => row.id === 'c_only_here')?.orgId).toBe(SURVIVOR)
    expect(plan.applied.contactsFolded).toBe(1)
    expect(plan.applied.contactsMoved).toBe(1)
    expect(plan.applied.contactReferencesRepointed).toBeGreaterThan(0)
  })

  it('leaves a team member reference on a dual-identity column alone', async () => {
    seedContactWorld()
    store.messages.push({ id: 'm2', orgId: SHELL, authorId: DUP, authorType: 'team_member', conversationId: null })
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    // Same id, different identity space: it is not this person and must not move.
    expect(store.messages.find((row) => row.id === 'm2')?.authorId).toBe(DUP)
  })

  it('drops the duplicate conversation participant instead of violating the one-per-room index', async () => {
    seedContactWorld()
    store.conversation_participants.push({ id: 'cp2', conversationId: 'cv_survivor', participantId: KEEP, participantType: 'contact' })
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    const inRoom = store.conversation_participants.filter((row) => row.conversationId === 'cv_survivor')
    expect(inRoom).toHaveLength(1)
    expect(inRoom[0].participantId).toBe(KEEP)
  })

  it('does not delete a contact that only moved', async () => {
    seedContactWorld()
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    expect(store.contacts.find((row) => row.id === 'c_only_here')).toBeDefined()
  })
})

// ── the org channel ──────────────────────────────────────────────────────────

describe('merge apply: the org message channel', () => {
  it('folds two org channels into one, because org_id is a unique index there', async () => {
    seedPair()
    store.conversations = [
      { id: 'cv_shell', orgId: SHELL, type: 'org_channel' },
      { id: 'cv_surv', orgId: SURVIVOR, type: 'org_channel' },
    ]
    store.messages = [{ id: 'm1', orgId: SHELL, conversationId: 'cv_shell', authorId: 'x', authorType: 'team_member' }]
    store.conversation_participants = [{ id: 'cp1', conversationId: 'cv_shell', participantId: 'p1', participantType: 'contact' }]

    const plan = await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })

    expect(store.conversations.map((row) => row.id)).toEqual(['cv_surv'])
    expect(store.messages[0].conversationId).toBe('cv_surv')
    expect(store.conversation_participants[0].conversationId).toBe('cv_surv')
    expect(plan.warnings.join(' ')).toMatch(/org message channel/i)
  })

  it('simply re-points the channel when the survivor has none', async () => {
    seedPair()
    store.conversations = [{ id: 'cv_shell', orgId: SHELL, type: 'org_channel' }]
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0].orgId).toBe(SURVIVOR)
  })
})

// ── access scoping ───────────────────────────────────────────────────────────

describe('merge apply: team member access rules', () => {
  it('does not list the survivor twice for one access rule', async () => {
    seedPair()
    store.team_member_access_orgs = [
      { id: 'tmao1', accessId: 'acc1', orgId: SHELL },
      { id: 'tmao2', accessId: 'acc1', orgId: SURVIVOR },
      { id: 'tmao3', accessId: 'acc2', orgId: SHELL },
    ]
    await runOrgMerge(db(), { shellId: SHELL, survivorId: SURVIVOR, dryRun: false })
    const forSurvivor = store.team_member_access_orgs.filter((row) => row.orgId === SURVIVOR)
    expect(forSurvivor.map((row) => row.accessId).sort()).toEqual(['acc1', 'acc2'])
  })
})
