/**
 * emitRequestStatusChanged: who is told when a request's status moves, on
 * which channel, and in whose words.
 *
 * A Tahi-internal request is hidden from the portal, so its contacts must
 * never receive a bell entry for it: the entry would carry the internal
 * title and deep-link to a 404. The assignee and the domain event are
 * unaffected, so automations and the team still see the move.
 *
 * Email is narrower than the bell three times over: only the two moves that
 * hand the next action to the client (client_review, delivered) reach an inbox,
 * only a caller that is not looping asks for one, and only the contacts the
 * brand-scoped portal would show the row to are in the audience.
 *
 * The db stub is real enough to answer loadRequestEmailContext, because the
 * [REQ-n] subject prefix and the client company name both come from it. One
 * case keeps the throwing stub so the graceful degradation stays pinned too.
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

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  leftJoin: () => SelectChain
  where: () => SelectChain
  limit: () => SelectChain
}

/** A database that answers the one joined read the email plan needs. */
function dbWith(rows: Row[]) {
  const chain = Promise.resolve(rows) as SelectChain
  chain.leftJoin = () => chain
  chain.where = () => chain
  chain.limit = () => chain
  return { select: () => ({ from: () => chain }) } as never
}

/** The database on a bad day: the lookup costs the prefix, never the email. */
const brokenDb = {
  select: () => { throw new Error('D1 unavailable') },
} as never

const db = dbWith([{ requestNumber: 7, orgName: 'Acme Ltd' }])
const base = { id: 'r1', title: 'Rebuild the checkout', orgId: 'o1', assigneeId: 'tm1' }

/** The payload notifyOrgContacts was handed, which carries the email plan. */
interface ClientPayload {
  title: string
  body?: string | null
  email?: {
    subject: string
    render: (target: {
      email: string
      name: string | null
      userType: 'contact'
      clerkUserId: null
    }) => { props: Record<string, unknown> }
  }
}
function clientPayload(index = 0): ClientPayload {
  return orgCalls[index][2] as ClientPayload
}
/** The optional 4th argument: the brand the audience is narrowed to. */
function clientAudience(index = 0): { brandId: string | null } | undefined {
  return orgCalls[index][3] as { brandId: string | null } | undefined
}

const contact = {
  email: 'jo@acme.com',
  name: 'Jo Yarnall',
  userType: 'contact' as const,
  clerkUserId: null,
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
    expect(clientPayload().email?.subject)
      .toBe('[REQ-7] Ready for your review: "Rebuild the checkout"')
  })

  it('emails the client when the request is delivered', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'delivered')
    expect(clientPayload().email?.subject).toBe('[REQ-7] Delivered: "Rebuild the checkout"')
  })

  it('greets the person and labels the company, not the person twice', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'delivered')
    const props = clientPayload().email?.render(contact).props
    expect(props?.recipientName).toBe('Jo')
    expect(props?.clientName).toBe('Acme Ltd')
    expect(props?.requestUrl).toContain('/requests/r1')
  })

  it('drops the prefix rather than the email when the lookup fails', async () => {
    await emitRequestStatusChanged(brokenDb, { ...base, isInternal: false }, 'delivered')
    expect(clientPayload().email?.subject).toBe('Delivered: "Rebuild the checkout"')
    expect(clientPayload().email?.render(contact).props.clientName).toBeNull()
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

  it('leaves the inbox alone for a caller in a loop, and still rings the bell', async () => {
    await emitRequestStatusChanged(
      db,
      { ...base, isInternal: false },
      'delivered',
      { clientEmail: false },
    )
    expect(orgCalls).toHaveLength(1)
    expect(clientPayload().email).toBeUndefined()
  })

  it('gates on exactly two statuses', () => {
    expect(isClientEmailStatus('client_review')).toBe(true)
    expect(isClientEmailStatus('delivered')).toBe(true)
    expect(isClientEmailStatus('in_review')).toBe(false)
    expect(isClientEmailStatus('in_progress')).toBe(false)
    expect(isClientEmailStatus('archived')).toBe(false)
  })
})

describe('emitRequestStatusChanged, the brand audience', () => {
  beforeEach(() => { orgCalls.length = 0; memberCalls.length = 0; events.length = 0 })

  it('narrows the audience to the brand when the caller read the column', async () => {
    await emitRequestStatusChanged(
      db,
      { ...base, isInternal: false, brandId: 'brand_1' },
      'delivered',
    )
    expect(clientAudience()).toEqual({ brandId: 'brand_1' })
  })

  it('says "no brand" rather than "unknown" when the column is null', async () => {
    // The portal hides a request with no brand from a brand-scoped contact, so
    // an explicit null has to reach the audience filter as a null.
    await emitRequestStatusChanged(
      db,
      { ...base, isInternal: false, brandId: null },
      'delivered',
    )
    expect(clientAudience()).toEqual({ brandId: null })
  })

  it('stays org wide when the caller never read the column', async () => {
    await emitRequestStatusChanged(db, { ...base, isInternal: false }, 'delivered')
    expect(clientAudience()).toBeUndefined()
  })
})
