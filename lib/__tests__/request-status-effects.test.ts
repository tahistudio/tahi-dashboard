/**
 * emitRequestStatusChanged: who is told when a request's status moves, on
 * which channel, and in whose words.
 *
 * A Tahi-internal request is hidden from the portal, so its contacts must
 * never receive a bell entry for it: the entry would carry the internal
 * title and deep-link to a 404. The assignee and the domain event are
 * unaffected, so automations and the team still see the move.
 *
 * Email is narrower than the bell on purpose: only the two moves that hand
 * the next action to the client (client_review, delivered) reach an inbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const orgCalls: unknown[][] = []
const memberCalls: unknown[][] = []
const events: unknown[] = []

vi.mock('@/lib/notifications', () => ({
  notifyOrgContacts: async (...args: unknown[]) => { orgCalls.push(args) },
  notifyTeamMember: async (...args: unknown[]) => { memberCalls.push(args) },
}))
vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: async (_db: unknown, event: unknown) => { events.push(event) },
}))

const { emitRequestStatusChanged, isClientEmailStatus } = await import('../request-status-effects')

const db = {} as never
const base = { id: 'r1', title: 'Rebuild the checkout', orgId: 'o1', assigneeId: 'tm1' }

/** The payload notifyOrgContacts was handed, which carries the email plan. */
interface ClientPayload {
  title: string
  body?: string | null
  email?: { subject: string }
}
function clientPayload(index = 0): ClientPayload {
  return orgCalls[index][2] as ClientPayload
}

describe('emitRequestStatusChanged', () => {
  beforeEach(() => { orgCalls.length = 0; memberCalls.length = 0; events.length = 0 })

  it('tells the client contacts about a client-visible move', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'in_progress')
    expect(orgCalls).toHaveLength(1)
    expect(orgCalls[0][1]).toBe('o1')
    expect(memberCalls).toHaveLength(1)
    expect(events).toHaveLength(1)
  })

  it('never tells the client contacts about a Tahi-internal request', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: true }, 'in_progress')
    expect(orgCalls).toHaveLength(0)
    expect(memberCalls).toHaveLength(1)
    expect(events).toHaveLength(1)
  })

  it('stays silent to the client on housekeeping moves', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'archived')
    expect(orgCalls).toHaveLength(0)
    expect(events).toHaveLength(1)
  })

  it('skips the assignee notification when nobody is assigned', async () => {
    await emitRequestStatusChanged(db, { ...base, assigneeId: null, isInternal: false }, 'delivered')
    expect(memberCalls).toHaveLength(0)
    expect(orgCalls).toHaveLength(1)
  })

  it('speaks to the client and to the assignee in different words', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'client_review')
    // The studio reads status names all day and wants the column value.
    expect((memberCalls[0][2] as { title: string }).title)
      .toBe('Request "Rebuild the checkout" status changed to client review')
    // The client gets an instruction, not a column name.
    expect(clientPayload().title).toBe('Your request is ready for your review')
    expect(clientPayload().body).toContain('waiting on your approval')
  })
})

describe('emitRequestStatusChanged, the email channel', () => {
  beforeEach(() => { orgCalls.length = 0; memberCalls.length = 0; events.length = 0 })

  it('emails the client when the request needs their review', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'client_review')
    expect(clientPayload().email?.subject).toBe('Ready for your review: "Rebuild the checkout"')
  })

  it('emails the client when the request is delivered', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'delivered')
    expect(clientPayload().email?.subject).toBe('Delivered: "Rebuild the checkout"')
  })

  it('never emails the client about studio housekeeping', async () => {
    for (const status of ['in_review', 'in_progress', 'submitted', 'on_hold']) {
      orgCalls.length = 0
      await emitRequestStatusChanged(db, { ...base, isInternal: false }, status)
      expect(orgCalls).toHaveLength(1)
      expect(clientPayload().email).toBeUndefined()
    }
  })

  it('never emails a client about a Tahi-internal request, delivered included', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: true }, 'delivered')
    expect(orgCalls).toHaveLength(0)
  })

  it('gates on exactly two statuses', () => {
    expect(isClientEmailStatus('client_review')).toBe(true)
    expect(isClientEmailStatus('delivered')).toBe(true)
    expect(isClientEmailStatus('in_review')).toBe(false)
    expect(isClientEmailStatus('in_progress')).toBe(false)
    expect(isClientEmailStatus('archived')).toBe(false)
  })
})
