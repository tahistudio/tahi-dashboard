import { describe, it, expect } from 'vitest'
import { firstHealthReason, isInvoiceOverdue, needsFor, type NeedsInput } from '../needs'

const NOW = new Date('2026-09-06T09:00:00.000Z')

function input(overrides: Partial<NeedsInput> = {}): NeedsInput {
  return {
    orgName: 'Kea Labs',
    status: 'active',
    healthStatus: 'green',
    healthNote: null,
    billingModel: 'retainer',
    requests: [],
    invoices: [],
    contracts: [],
    contacts: [],
    calls: [
      // A booked call by default, so the "no call" rule stays out of the way
      // unless a test is about it.
      { id: 'c1', scheduledAt: '2026-09-20T09:00:00.000Z', status: 'scheduled' },
    ],
    trackCount: 0,
    occupiedTrackCount: 0,
    now: NOW,
    ...overrides,
  }
}

describe('needsFor', () => {
  it('says nothing when there is nothing to say', () => {
    expect(needsFor(input())).toEqual([])
  })

  it('flags an invoice past its due date even when the status is still sent', () => {
    const items = needsFor(input({
      invoices: [{ id: 'i1', status: 'sent', totalAmount: 4000, currency: 'NZD', dueDate: '2026-08-30' }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].tone).toBe('danger')
    expect(items[0].tab).toBe('invoices')
    expect(items[0].text).toContain('overdue')
  })

  it('flags a viewed invoice past its due date, the same as a sent one', () => {
    const items = needsFor(input({
      invoices: [{ id: 'i1', status: 'viewed', totalAmount: 4000, currency: 'NZD', dueDate: '2026-08-30' }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].tone).toBe('danger')
    expect(items[0].tab).toBe('invoices')
  })

  it('drops the money rules for a viewer without the billing card', () => {
    const invoices = [
      { id: 'i1', status: 'overdue', totalAmount: 4000, currency: 'NZD', dueDate: '2026-08-01' },
    ]
    expect(needsFor(input({ invoices }))).toHaveLength(1)
    expect(needsFor(input({ invoices, canMoney: false }))).toEqual([])
  })

  it('asks for the first request only while onboarding is still a first run', () => {
    const firstRun = needsFor(input({
      onboarding: { firstRunEligible: true, done: 1, total: 4, awaitingFirstRequest: true },
    }))
    expect(firstRun.some(i => i.key === 'onboarding')).toBe(true)
    expect(firstRun.find(i => i.key === 'onboarding')?.tab).toBe('requests')

    const established = needsFor(input({
      onboarding: { firstRunEligible: false, done: 1, total: 4, awaitingFirstRequest: true },
    }))
    expect(established.some(i => i.key === 'onboarding')).toBe(false)

    const sent = needsFor(input({
      onboarding: { firstRunEligible: true, done: 3, total: 4, awaitingFirstRequest: false },
    }))
    expect(sent.some(i => i.key === 'onboarding')).toBe(false)
  })

  it('leaves a paid invoice alone', () => {
    const items = needsFor(input({
      invoices: [{ id: 'i1', status: 'paid', totalAmount: 4000, currency: 'NZD', dueDate: '2026-08-30' }],
    }))
    expect(items).toEqual([])
  })

  it('opens the request itself rather than a tab for an overdue request', () => {
    const items = needsFor(input({
      requests: [{ id: 'r1', requestNumber: 42, title: 'Homepage refresh', status: 'in_progress', dueDate: '2026-09-01' }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].requestId).toBe('r1')
    expect(items[0].tab).toBeUndefined()
    expect(items[0].text).toContain('#42 Homepage refresh')
  })

  it('counts a client_review request as waiting on the client', () => {
    const items = needsFor(input({
      requests: [{ id: 'r1', title: 'Logo pack', status: 'client_review', updatedAt: '2026-09-01T09:00:00.000Z' }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].tone).toBe('warn')
    expect(items[0].text).toContain('has been with Kea Labs for 5 days')
  })

  it('warns on a contract inside its last sixty days but not before', () => {
    const soon = needsFor(input({
      contracts: [{ id: 'k1', name: 'MSA', status: 'signed', expiryDate: '2026-10-01' }],
    }))
    expect(soon).toHaveLength(1)
    expect(soon[0].tab).toBe('papers')

    const later = needsFor(input({
      contracts: [{ id: 'k1', name: 'MSA', status: 'signed', expiryDate: '2027-10-01' }],
    }))
    expect(later).toEqual([])
  })

  it('asks for a call only on a live retainer with none booked', () => {
    const retainer = needsFor(input({ calls: [] }))
    expect(retainer.some(i => i.key === 'nocall')).toBe(true)

    const project = needsFor(input({ calls: [], billingModel: 'project' }))
    expect(project.some(i => i.key === 'nocall')).toBe(false)

    const paused = needsFor(input({ calls: [], status: 'paused' }))
    expect(paused.some(i => i.key === 'nocall')).toBe(false)
  })

  it('calls an account quiet only when nothing has moved for three weeks', () => {
    const quiet = needsFor(input({
      calls: [{ id: 'c1', scheduledAt: '2026-07-01T09:00:00.000Z', status: 'completed' }],
      requests: [{ id: 'r1', title: 'Old work', status: 'delivered', updatedAt: '2026-07-02T09:00:00.000Z' }],
    }))
    expect(quiet.some(i => i.key === 'quiet')).toBe(true)

    const busy = needsFor(input({
      requests: [{ id: 'r1', title: 'Recent work', status: 'delivered', updatedAt: '2026-09-05T09:00:00.000Z' }],
    }))
    expect(busy.some(i => i.key === 'quiet')).toBe(false)
  })

  it('flags idle tracks only when nothing is queued either', () => {
    const idle = needsFor(input({ trackCount: 2, occupiedTrackCount: 0 }))
    expect(idle.some(i => i.key === 'idle')).toBe(true)

    const queued = needsFor(input({
      trackCount: 2,
      occupiedTrackCount: 0,
      requests: [{ id: 'r1', title: 'Queued', status: 'submitted' }],
    }))
    expect(queued.some(i => i.key === 'idle')).toBe(false)
  })

  it('puts an at-risk account first and names the reason', () => {
    const items = needsFor(input({
      healthStatus: 'red',
      healthNote: 'Two invoices unpaid. The sponsor has gone quiet since the rebrand.',
      invoices: [{ id: 'i1', status: 'overdue', totalAmount: 4000, currency: 'NZD', dueDate: '2026-08-01' }],
    }))
    expect(items[0].key).toBe('risk')
    expect(items[0].text).toBe('At risk: Two invoices unpaid.')
    expect(items[0].tab).toBe('calls')
    // A call is already booked, so the action is to prepare rather than book.
    expect(items[0].action).toBe('Prep the call')
  })

  it('offers to book when an at-risk account has no call', () => {
    const items = needsFor(input({ healthStatus: 'red', calls: [] }))
    expect(items[0].action).toBe('Book a call')
    expect(items[0].text).toContain('no reason recorded yet')
  })

  it('reports contacts without portal access as one line, not one each', () => {
    const items = needsFor(input({
      contacts: [
        { id: 'p1', name: 'Ana', clerkUserId: null },
        { id: 'p2', name: 'Bo', clerkUserId: null },
        { id: 'p3', name: 'Cy', clerkUserId: 'user_1' },
      ],
    }))
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('2 contacts have no portal access yet')
    expect(items[0].tab).toBe('people')
  })
})

describe('isInvoiceOverdue', () => {
  it('counts overdue, and sent or viewed past the due date', () => {
    expect(isInvoiceOverdue({ status: 'overdue', dueDate: null }, NOW)).toBe(true)
    expect(isInvoiceOverdue({ status: 'sent', dueDate: '2026-08-30' }, NOW)).toBe(true)
    expect(isInvoiceOverdue({ status: 'viewed', dueDate: '2026-08-30' }, NOW)).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isInvoiceOverdue({ status: 'sent', dueDate: '2026-10-30' }, NOW)).toBe(false)
    expect(isInvoiceOverdue({ status: 'viewed', dueDate: null }, NOW)).toBe(false)
    expect(isInvoiceOverdue({ status: 'paid', dueDate: '2026-08-30' }, NOW)).toBe(false)
    expect(isInvoiceOverdue({ status: 'draft', dueDate: '2026-08-30' }, NOW)).toBe(false)
    expect(isInvoiceOverdue({ status: 'written_off', dueDate: '2026-08-30' }, NOW)).toBe(false)
  })
})

describe('firstHealthReason', () => {
  it('returns null when there is no note', () => {
    expect(firstHealthReason({ healthNote: null })).toBeNull()
    expect(firstHealthReason({ healthNote: '   ' })).toBeNull()
  })

  it('takes the first sentence so the strip stays one line', () => {
    expect(firstHealthReason({ healthNote: 'Sponsor left. New CMO starts in October.' }))
      .toBe('Sponsor left.')
  })

  it('truncates a single very long sentence', () => {
    const long = `${'a'.repeat(200)}.`
    const out = firstHealthReason({ healthNote: long })
    expect(out).not.toBeNull()
    expect((out as string).length).toBe(140)
    expect(out).toMatch(/\.\.\.$/)
  })
})
