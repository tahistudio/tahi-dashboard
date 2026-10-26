import { describe, it, expect, vi, beforeEach } from 'vitest'

const notifyOrgContacts = vi.fn(async () => undefined)
const notifyAllAdmins = vi.fn(async () => undefined)

vi.mock('@/lib/notifications', () => ({
  notifyOrgContacts: (...args: unknown[]) => notifyOrgContacts(...(args as [])),
  notifyAllAdmins: (...args: unknown[]) => notifyAllAdmins(...(args as [])),
}))

import { fireAutomation } from '@/lib/automation-executor'
import { schema } from '@/db/d1'

type Database = Parameters<typeof fireAutomation>[0]

/**
 * Minimal fake Drizzle handle. select() on automationRules returns the rules;
 * select() on requests returns the row lookup; inserts and updates are no-ops.
 */
function fakeDb(opts: { audience: 'client' | 'team'; rowIsInternal?: boolean; lookupThrows?: boolean }) {
  const rule = {
    id: 'rule-1',
    name: 'Tell the client',
    enabled: true,
    triggerEvent: 'request_status_changed',
    conditions: '[]',
    actions: JSON.stringify([{ type: 'send_notification', config: { audience: opts.audience } }]),
    executionCount: 0,
  }
  const lookups: string[] = []
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === schema.automationRules) return Promise.resolve([rule])
          lookups.push('requests')
          if (opts.lookupThrows) return { limit: () => Promise.reject(new Error('boom')) }
          return { limit: () => Promise.resolve([{ isInternal: opts.rowIsInternal ?? false }]) }
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }
  return { db: db as unknown as Database, lookups }
}

const event = {
  event: 'request_status_changed',
  entityId: 'req-1',
  entityType: 'request',
  orgId: 'org-1',
  data: {} as Record<string, unknown>,
}

describe('fireAutomation client audience and internal requests', () => {
  beforeEach(() => {
    notifyOrgContacts.mockClear()
    notifyAllAdmins.mockClear()
  })

  it('does not notify client contacts for an internal request (row lookup)', async () => {
    const { db } = fakeDb({ audience: 'client', rowIsInternal: true })
    await fireAutomation(db, event)
    expect(notifyOrgContacts).not.toHaveBeenCalled()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('does not notify client contacts when the payload flags it internal', async () => {
    const { db, lookups } = fakeDb({ audience: 'client' })
    await fireAutomation(db, { ...event, event: 'request_status_changed', data: { isInternal: 1 } })
    expect(notifyOrgContacts).not.toHaveBeenCalled()
    expect(lookups).toHaveLength(0)
  })

  it('fails closed when the request lookup throws', async () => {
    const { db } = fakeDb({ audience: 'client', lookupThrows: true })
    await fireAutomation(db, event)
    expect(notifyOrgContacts).not.toHaveBeenCalled()
  })

  it('still fires a team-audience rule for an internal request', async () => {
    const { db } = fakeDb({ audience: 'team', rowIsInternal: true })
    await fireAutomation(db, event)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    expect(notifyOrgContacts).not.toHaveBeenCalled()
  })

  it('leaves a non-internal request unchanged (client contacts notified)', async () => {
    const { db } = fakeDb({ audience: 'client', rowIsInternal: false })
    await fireAutomation(db, event)
    expect(notifyOrgContacts).toHaveBeenCalledTimes(1)
  })

  it('uses the payload flag for request_created without a lookup', async () => {
    const { db, lookups } = fakeDb({ audience: 'client' })
    await fireAutomation(db, { ...event, data: { isInternal: 0 } })
    expect(notifyOrgContacts).toHaveBeenCalledTimes(1)
    expect(lookups).toHaveLength(0)
  })
})
