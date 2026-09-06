/**
 * The plan builders, against a fake ManyRequests payload.
 *
 * The two properties that matter most are pinned here:
 *
 *   1. IDEMPOTENCE. Planning the same source against the world the first plan
 *      would build yields ZERO inserts and zero updates. That is what makes the
 *      import safely re-runnable, and it is only true because migration 0093
 *      gives every table an external id to key on.
 *   2. SILENCE BY CONSTRUCTION. No planned contact carries a clerkUserId and no
 *      planned organisation carries a clerkOrgId, which is what stops a
 *      notification ever resolving to a human on an imported row.
 */
import { describe, it, expect } from 'vitest'
import {
  MANYREQUESTS_TEAM,
  PLAN_BUILDERS,
  diffFields,
  projectPlan,
  sameValue,
  type ImportSnapshot,
  type ImportSource,
  type PlanOptions,
} from '../plan'
import { IMPORT_ENTITY_ORDER, type EntityPlan } from '../types'

const NOW = '2026-09-07T00:00:00.000Z'

const OPTIONS: PlanOptions = { closedAs: 'cancelled', since: null, now: NOW }

function emptySnapshot(): ImportSnapshot {
  return {
    orgs: [],
    contacts: [],
    teamMembers: [],
    roles: [
      { id: 'role-super-admin', name: 'super_admin' },
      { id: 'role-task-handler', name: 'task_handler' },
    ],
    teamMemberRoles: [],
    brands: [],
    services: [],
    subscriptions: [],
    requests: [],
    messages: [],
    invoices: [],
    invoiceItems: [],
  }
}

function source(): ImportSource {
  return {
    organizations: [
      {
        id: 3,
        name: 'Glasswall',
        owner: { id: 20, name: 'Jake Bussell', email: 'jbussell@glasswall.com' },
        created_at: '2024-01-01T00:00:00Z',
        subscription_status: 'subscribed',
        balance: { hours: 15, purchased_hours: 21 },
      },
      {
        id: 18,
        name: 'Blank Space Inc',
        owner: { id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca' },
        created_at: '2024-02-01T00:00:00Z',
        subscription_status: 'unsubscribed',
        balance: { hours: -6.57 },
      },
      {
        id: 46,
        name: "SA Design's Organization",
        created_at: '2025-01-01T00:00:00Z',
        subscription_status: 'unsubscribed',
      },
    ],
    membersByOrg: {
      '3': [
        { id: 20, name: 'Jake Bussell', email: 'jbussell@glasswall.com', is_owner: true, created_at: '2024-01-01T00:00:00Z' },
        { id: 21, name: 'Sara Scerbo', email: 'sscerbo@glasswall.com', created_at: '2024-03-01T00:00:00Z' },
      ],
      '18': [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca', is_owner: true }],
    },
    brandsByOrg: { '3': [], '18': [] },
    subscriptionsByOrg: {
      '3': [
        {
          service: { id: 5, name: 'Glasswall Custom Retainer' },
          status: 'active',
          billing_period: 'Monthly',
          member: { name: 'Suzy Toth' },
          hours_per_period: 15,
          created_at: '2024-01-05T00:00:00Z',
        },
      ],
      '18': [],
    },
    services: [
      { id: 5, name: 'Glasswall Custom Retainer', type: 'recurring', currency: 'GBP', price: 1000, hours: 15 },
      { id: 33, name: 'Essential Brand Identity Refresh', type: 'one_off', currency: 'USD', price: 1350 },
    ],
    requests: [
      {
        id: 347,
        number: 347,
        title: 'Custom Redirects',
        status: 'In progress',
        priority: 'high',
        organization: { id: 3, name: 'Glasswall' },
        client: { id: 21, name: 'Sara Scerbo' },
        assignees: ['Liam Miller', 'Nathan Day'],
        created_at: '2026-08-01T00:00:00Z',
        due_date: '2026-09-30',
        hours: { time_estimate_hours: 3 },
        fields: [{ label: 'Description and supporting links/information', type: 'textarea', value: 'Redirect map attached' }],
        comments: [
          { author: 'Nathan Day', content: 'On it &#039;today&#039;', is_internal: false, created_at: '2026-08-02T00:00:00Z' },
          { author: 'Sara Scerbo', content: 'Thanks', is_internal: false, created_at: '2026-08-03T00:00:00Z' },
          { author: 'A Ghost', content: 'who?', is_internal: false, created_at: '2026-08-04T00:00:00Z' },
        ],
        comments_total: 3,
      },
      {
        id: 340,
        number: 340,
        title: 'Old closed thing',
        status: 'Closed',
        organization: { id: 3, name: 'Glasswall' },
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
    invoices: [
      {
        number: 'INV-2025000024',
        status: 'pending',
        amount: 1279.67,
        subtotal: 1150,
        currency: 'GBP',
        created_at: '2025-12-27T00:00:00Z',
        organization: { id: 4, name: 'Greyhive' },
        line_items: [
          { name: 'Webflow services', quantity: 1, unit_price: 1150, subtotal: 1150 },
          { name: 'Late Fee', quantity: 1, unit_price: 129.67, subtotal: 129.67 },
        ],
      },
    ],
  }
}

/** Run every entity in dependency order, projecting each plan forward. */
function runAllPlans(snapshot: ImportSnapshot, src: ImportSource, options = OPTIONS) {
  const plans: EntityPlan[] = []
  let current = snapshot
  for (const entity of IMPORT_ENTITY_ORDER) {
    const plan = PLAN_BUILDERS[entity](src, current, options)
    plans.push(plan)
    current = projectPlan(current, plan)
  }
  return { plans, snapshot: current }
}

describe('the diff', () => {
  it('only considers the fields it was told it may write', () => {
    const existing = { name: 'Old', xeroContactId: 'xero_1', status: 'active' }
    const desired = { name: 'New', xeroContactId: null, status: 'churned' }
    expect(diffFields(existing, desired, ['name'])).toEqual({ name: 'New' })
  })

  it('treats undefined as null and compares numbers and booleans on value', () => {
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue(1, '1')).toBe(true)
    expect(sameValue(true, 1)).toBe(true)
    expect(sameValue(false, 0)).toBe(true)
    expect(sameValue(null, 0)).toBe(false)
    expect(sameValue('a', 'b')).toBe(false)
  })
})

describe('team', () => {
  it('creates Nathan with a role, corrects Staci, and only stamps an id on Liam', () => {
    const snapshot = emptySnapshot()
    snapshot.teamMembers = [
      { id: 'tm_liam', name: 'Liam Miller', email: 'business@tahi.studio', title: 'Founder', manyrequestsId: null },
      { id: 'tm_staci', name: 'Staci Orchard', email: 'staci@tahi.studio', title: null, manyrequestsId: null },
    ]
    snapshot.teamMemberRoles = [
      { id: 'tmr_liam', teamMemberId: 'tm_liam', roleId: 'role-super-admin', endedAt: null },
      { id: 'tmr_staci', teamMemberId: 'tm_staci', roleId: 'role-super-admin', endedAt: null },
    ]

    const plan = PLAN_BUILDERS.team(source(), snapshot, OPTIONS)

    const nathan = plan.toInsert.find((row) => row.label === 'Nathan Day')
    expect(nathan?.values.email).toBe('nathan@tahi.studio')
    expect(nathan?.values.manyrequestsId).toBe('83')
    // Rows only. No Clerk identity is ever invented for a team member.
    expect(nathan?.values.clerkUserId).toBeNull()

    const nathanRole = plan.toInsert.find((row) => row.table === 'team_member_roles')
    expect(nathanRole?.values.roleId).toBe('role-task-handler')
    expect(nathanRole?.values.__teamMemberEmail).toBe('nathan@tahi.studio')

    const staci = plan.toUpdate.find((row) => row.id === 'tm_staci')
    expect(staci?.changes.name).toBe('Staci Bonnie')
    expect(staci?.changes.manyrequestsId).toBe('19')

    const liam = plan.toUpdate.find((row) => row.id === 'tm_liam')
    expect(liam?.changes).toEqual({ manyrequestsId: '1', updatedAt: NOW })
  })

  it('refuses the role assignment loudly when the roles table has not been seeded', () => {
    const snapshot = emptySnapshot()
    snapshot.roles = []
    const plan = PLAN_BUILDERS.team(source(), snapshot, OPTIONS)
    expect(plan.skipped).toHaveLength(MANYREQUESTS_TEAM.length)
    expect(plan.skipped[0].reason).toContain('Seed the roles table')
  })
})

describe('organisations', () => {
  it('creates the missing org, adopts the renamed one and never overwrites D1 truth', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [
      {
        id: 'org_glasswall',
        name: 'Glasswall Solutions Ltd',
        status: 'active',
        manyrequestsId: null,
        mrHoursRemaining: null,
        mrHoursPurchased: null,
      },
    ]
    const plan = PLAN_BUILDERS.organisations(source(), snapshot, OPTIONS)

    const created = plan.toInsert.find((row) => row.manyrequestsId === '18')
    expect(created?.values.name).toBe('Blank Space Inc')
    expect(created?.values.status).toBe('churned')
    // An imported organisation holds no Clerk workspace.
    expect(created?.values.clerkOrgId).toBeNull()

    const adopted = plan.toUpdate.find((row) => row.id === 'org_glasswall')
    expect(adopted?.changes.manyrequestsId).toBe('3')
    expect(adopted?.changes.mrHoursRemaining).toBe(15)
    expect(adopted?.changes.mrHoursPurchased).toBe(21)
    // Name and status are untouched: the D1 name is better and the D1 status
    // is not archived, so there is nothing to reopen.
    expect(adopted?.changes.name).toBeUndefined()
    expect(adopted?.changes.status).toBeUndefined()
  })

  it('reopens an archived org that ManyRequests still shows as live (the Greyhive case)', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [
      { id: 'org_gw', name: 'Glasswall Solutions Ltd', status: 'archived', manyrequestsId: null, mrHoursRemaining: null, mrHoursPurchased: null },
    ]
    const plan = PLAN_BUILDERS.organisations(source(), snapshot, OPTIONS)
    expect(plan.toUpdate.find((row) => row.id === 'org_gw')?.changes.status).toBe('active')
  })

  it('never reopens or closes an org a human already set to churned', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [
      { id: 'org_gw', name: 'Glasswall Solutions Ltd', status: 'churned', manyrequestsId: null, mrHoursRemaining: null, mrHoursPurchased: null },
    ]
    const plan = PLAN_BUILDERS.organisations(source(), snapshot, OPTIONS)
    expect(plan.toUpdate.find((row) => row.id === 'org_gw')?.changes.status).toBeUndefined()
  })

  it('refuses the empty self-signup shell with a reason', () => {
    const plan = PLAN_BUILDERS.organisations(source(), emptySnapshot(), OPTIONS)
    const refused = plan.skipped.find((row) => row.manyrequestsId === '46')
    expect(refused?.reason).toContain('Empty self-signup shell')
    expect(plan.toInsert.some((row) => row.manyrequestsId === '46')).toBe(false)
  })

  it('honours the since cutoff with a reason instead of dropping the row', () => {
    const plan = PLAN_BUILDERS.organisations(source(), emptySnapshot(), { ...OPTIONS, since: '2025-06-01T00:00:00.000Z' })
    expect(plan.toInsert).toHaveLength(0)
    expect(plan.skipped.every((row) => row.reason.includes('since cutoff') || row.reason.includes('self-signup'))).toBe(true)
  })
})

describe('contacts', () => {
  it('never writes a clerkUserId on any planned contact', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const contacts = plans.find((plan) => plan.entity === 'contacts')
    expect(contacts?.toInsert.length).toBeGreaterThan(0)
    for (const row of contacts?.toInsert ?? []) {
      expect(row.values.clerkUserId).toBeNull()
    }
    for (const row of contacts?.toUpdate ?? []) {
      expect(Object.keys(row.changes)).not.toContain('clerkUserId')
    }
  })

  it('marks the owner as the portal admin and everyone else as a member', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const contacts = plans.find((plan) => plan.entity === 'contacts')
    const owner = contacts?.toInsert.find((row) => row.manyrequestsId === '20')
    const member = contacts?.toInsert.find((row) => row.manyrequestsId === '21')
    expect(owner?.values.portalRole).toBe('admin')
    expect(owner?.values.isPrimary).toBe(true)
    expect(member?.values.portalRole).toBe('member')
    expect(member?.values.isPrimary).toBe(false)
  })

  it('replaces the fake Elevate address rather than leaving a live client unreachable', () => {
    const src = source()
    src.organizations = [{ id: 7, name: 'Elevate', created_at: '2024-01-01T00:00:00Z', subscription_status: 'subscribed' }]
    src.membersByOrg = { '7': [{ id: 58, name: 'Andrew Stout', email: 'andrew@test.com', is_owner: true }] }
    const snapshot = emptySnapshot()
    snapshot.orgs = [{
      id: 'org_elevate',
      name: 'Telcom Networks Limited trading as Elevate',
      status: 'active',
      manyrequestsId: null,
      mrHoursRemaining: null,
      mrHoursPurchased: null,
    }]
    const { plans } = runAllPlans(snapshot, src)
    const contacts = plans.find((plan) => plan.entity === 'contacts')
    expect(contacts?.toInsert[0]?.values.email).toBe('andrew.stout@elevate.uk')
  })

  it('never demotes a contact who is already the portal admin on this side', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_gw', name: 'Glasswall Solutions Ltd', status: 'active', manyrequestsId: '3', mrHoursRemaining: null, mrHoursPurchased: null }]
    snapshot.contacts = [{
      id: 'c_sara',
      orgId: 'org_gw',
      name: 'Sara Scerbo',
      email: 'sscerbo@glasswall.com',
      isPrimary: true,
      portalRole: 'admin',
      clerkUserId: null,
      manyrequestsId: null,
    }]
    const plan = PLAN_BUILDERS.contacts(source(), snapshot, OPTIONS)
    const sara = plan.toUpdate.find((row) => row.id === 'c_sara')
    expect(sara?.changes.portalRole).toBeUndefined()
    expect(sara?.changes.manyrequestsId).toBe('21')
  })
})

describe('requests', () => {
  it('maps the brief, the first assignee, the number and the status note', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const requests = plans.find((plan) => plan.entity === 'requests')
    const row = requests?.toInsert.find((entry) => entry.manyrequestsId === '347')
    expect(row?.values.title).toBe('Custom Redirects')
    expect(row?.values.status).toBe('in_progress')
    expect(row?.values.priority).toBe('high')
    expect(row?.values.requestNumber).toBe(347)
    expect(row?.values.description).toBe('Redirect map attached')
    expect(row?.values.estimatedHours).toBe(3)
    expect(row?.values.isInternal).toBe(false)
    const form = JSON.parse(String(row?.values.formResponses)) as { _manyrequests: Record<string, unknown> }
    expect(form._manyrequests.unassignedExtraAssignees).toEqual(['Nathan Day'])
  })

  it('reports every Closed request as needing a ruling', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const requests = plans.find((plan) => plan.entity === 'requests')
    expect(requests?.unmapped.some((line) => line.includes('Old closed thing'))).toBe(true)
    expect(requests?.toInsert.find((row) => row.manyrequestsId === '340')?.values.status).toBe('cancelled')
  })

  it('adopts a hand-typed duplicate by title instead of doubling the board', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_gw', name: 'Glasswall Solutions Ltd', status: 'active', manyrequestsId: '3', mrHoursRemaining: null, mrHoursPurchased: null }]
    snapshot.requests = [{
      id: 'req_hand_typed',
      orgId: 'org_gw',
      title: 'Custom Redirects',
      status: 'submitted',
      priority: 'standard',
      assigneeId: null,
      requestNumber: null,
      dueDate: null,
      deliveredAt: null,
      estimatedHours: null,
      brandId: null,
      description: null,
      formResponses: '{}',
      submittedById: null,
      submittedByType: null,
      manyrequestsId: null,
    }]
    const plan = PLAN_BUILDERS.requests(source(), snapshot, OPTIONS)
    expect(plan.toInsert.some((row) => row.manyrequestsId === '347')).toBe(false)
    const adopted = plan.toUpdate.find((row) => row.id === 'req_hand_typed')
    expect(adopted?.changes.manyrequestsId).toBe('347')
    expect(adopted?.changes.status).toBe('in_progress')
  })

  it('skips a request whose organisation cannot be resolved, with the reason', () => {
    const src = source()
    src.organizations = []
    src.membersByOrg = {}
    const plan = PLAN_BUILDERS.requests(src, emptySnapshot(), OPTIONS)
    expect(plan.toInsert).toHaveLength(0)
    expect(plan.skipped[0].reason).toContain('Could not resolve its organisation')
  })
})

describe('messages', () => {
  it('unescapes the body, keeps is_internal, and leaves conversationId null', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const messages = plans.find((plan) => plan.entity === 'messages')
    const nathan = messages?.toInsert.find((row) => row.label.includes('Nathan Day'))
    expect(nathan?.values.body).toBe("On it 'today'")
    expect(nathan?.values.authorType).toBe('team_member')
    expect(nathan?.values.isInternal).toBe(false)
    expect(nathan?.values.conversationId).toBeNull()
  })

  it('resolves a client author to a contact, not to the studio', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const messages = plans.find((plan) => plan.entity === 'messages')
    const sara = messages?.toInsert.find((row) => row.label.includes('Sara Scerbo'))
    expect(sara?.values.authorType).toBe('contact')
  })

  it('skips an unresolvable author rather than attributing them to the wrong side', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    const messages = plans.find((plan) => plan.entity === 'messages')
    const ghost = messages?.skipped.find((row) => row.label.includes('A Ghost'))
    expect(ghost?.reason).toContain('resolves to neither a team member nor a contact')
  })
})

describe('invoices', () => {
  it('lands the live receivable as sent, historic, with no rail ids and no sentAt', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_greyhive', name: 'Greyhive', status: 'active', manyrequestsId: '4', mrHoursRemaining: null, mrHoursPurchased: null }]
    const plan = PLAN_BUILDERS.invoices(source(), snapshot, OPTIONS)
    const invoice = plan.toInsert.find((row) => row.table === undefined)
    expect(invoice?.values.status).toBe('sent')
    expect(invoice?.values.source).toBe('manyrequests')
    expect(invoice?.values.currency).toBe('GBP')
    expect(invoice?.values.totalUsd).toBe(1279.67)
    expect(invoice?.values.reconciliationStatus).toBe('historic')
    expect(invoice?.values.stripeInvoiceId).toBeNull()
    expect(invoice?.values.xeroInvoiceId).toBeNull()
    // sentAt is what puts an invoice in the chase flow. Never stamped.
    expect(invoice?.values.sentAt).toBeNull()
    expect(invoice?.values.paidAt).toBeNull()
  })

  it('plans both line items against the parent invoice', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_greyhive', name: 'Greyhive', status: 'active', manyrequestsId: '4', mrHoursRemaining: null, mrHoursPurchased: null }]
    const plan = PLAN_BUILDERS.invoices(source(), snapshot, OPTIONS)
    const lines = plan.toInsert.filter((row) => row.table === 'invoice_items')
    expect(lines).toHaveLength(2)
    expect(lines[0].values.description).toBe('Webflow services')
    expect(lines[0].values.__invoiceManyrequestsId).toBe('INV-2025000024')
    expect(lines[1].values.totalUsd).toBe(129.67)
  })

  it('removes an imported line that no longer exists upstream', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_greyhive', name: 'Greyhive', status: 'active', manyrequestsId: '4', mrHoursRemaining: null, mrHoursPurchased: null }]
    snapshot.invoices = [{
      id: 'inv_1',
      orgId: 'org_greyhive',
      status: 'sent',
      currency: 'GBP',
      amountUsd: 1150,
      totalUsd: 1279.67,
      taxAmountUsd: 0,
      discountAmountUsd: 0,
      paidAt: null,
      source: 'manyrequests',
      manyrequestsId: 'INV-2025000024',
    }]
    snapshot.invoiceItems = [
      { id: 'item_0', invoiceId: 'inv_1', description: 'Webflow services', quantity: 1, unitPriceUsd: 1150, totalUsd: 1150, manyrequestsId: 'INV-2025000024#0' },
      { id: 'item_1', invoiceId: 'inv_1', description: 'Late Fee', quantity: 1, unitPriceUsd: 129.67, totalUsd: 129.67, manyrequestsId: 'INV-2025000024#1' },
      { id: 'item_stale', invoiceId: 'inv_1', description: 'Removed upstream', quantity: 1, unitPriceUsd: 5, totalUsd: 5, manyrequestsId: 'INV-2025000024#2' },
    ]
    const plan = PLAN_BUILDERS.invoices(source(), snapshot, OPTIONS)
    expect(plan.toDelete).toHaveLength(1)
    expect(plan.toDelete[0].id).toBe('item_stale')
  })

  it('never deletes a hand-made line item, only an imported one', () => {
    const snapshot = emptySnapshot()
    snapshot.orgs = [{ id: 'org_greyhive', name: 'Greyhive', status: 'active', manyrequestsId: '4', mrHoursRemaining: null, mrHoursPurchased: null }]
    snapshot.invoices = [{
      id: 'inv_1', orgId: 'org_greyhive', status: 'sent', currency: 'GBP',
      amountUsd: 1150, totalUsd: 1279.67, taxAmountUsd: 0, discountAmountUsd: 0,
      paidAt: null, source: 'manyrequests', manyrequestsId: 'INV-2025000024',
    }]
    snapshot.invoiceItems = [
      { id: 'item_hand', invoiceId: 'inv_1', description: 'Typed by hand', quantity: 1, unitPriceUsd: 5, totalUsd: 5, manyrequestsId: null },
    ]
    const plan = PLAN_BUILDERS.invoices(source(), snapshot, OPTIONS)
    expect(plan.toDelete).toHaveLength(0)
  })
})

describe('idempotence', () => {
  it('a second plan over the world the first would build inserts and updates nothing', () => {
    const first = runAllPlans(emptySnapshot(), source())
    const firstWrites = first.plans.reduce(
      (total, plan) => total + plan.toInsert.length + plan.toUpdate.length,
      0,
    )
    expect(firstWrites).toBeGreaterThan(0)

    const second = runAllPlans(first.snapshot, source())
    for (const plan of second.plans) {
      expect({ entity: plan.entity, inserts: plan.toInsert.length }).toEqual({ entity: plan.entity, inserts: 0 })
      expect({ entity: plan.entity, updates: plan.toUpdate.length }).toEqual({ entity: plan.entity, updates: 0 })
      expect({ entity: plan.entity, deletes: plan.toDelete.length }).toEqual({ entity: plan.entity, deletes: 0 })
    }
  })

  it('a third run is still a no-op, so re-running is never cumulative', () => {
    const first = runAllPlans(emptySnapshot(), source())
    const second = runAllPlans(first.snapshot, source())
    const third = runAllPlans(second.snapshot, source())
    const writes = third.plans.reduce((total, plan) => total + plan.toInsert.length + plan.toUpdate.length, 0)
    expect(writes).toBe(0)
  })
})

describe('every plan is inert', () => {
  it('plans nothing that carries a Clerk identity, on any entity', () => {
    const { plans } = runAllPlans(emptySnapshot(), source())
    for (const plan of plans) {
      for (const row of plan.toInsert) {
        expect(row.values.clerkOrgId ?? null).toBeNull()
        expect(row.values.clerkUserId ?? null).toBeNull()
      }
      for (const row of plan.toUpdate) {
        expect(Object.keys(row.changes)).not.toContain('clerkOrgId')
        expect(Object.keys(row.changes)).not.toContain('clerkUserId')
      }
    }
  })
})
