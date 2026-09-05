/**
 * emitRequestStatusChanged: who is told when a request's status moves.
 *
 * A Tahi-internal request is hidden from the portal, so its contacts must
 * never receive a bell entry for it: the entry would carry the internal
 * title and deep-link to a 404. The assignee and the domain event are
 * unaffected, so automations and the team still see the move.
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

const { emitRequestStatusChanged } = await import('../request-status-effects')

const db = {} as never
const base = { id: 'r1', title: 'Rebuild the checkout', orgId: 'o1', assigneeId: 'tm1' }

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
})
