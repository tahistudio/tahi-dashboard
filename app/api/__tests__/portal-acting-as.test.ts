/**
 * The portal writes that Act as client opens, and the ones it does not.
 *
 * Two questions per route, and both have to keep their answer:
 *   1. Read-only Client view still gets the exact 403 it always did. That
 *      string is a contract the portal UI and a dozen other suites read.
 *   2. An acting write lands, is attributed to the STUDIO member rather than to
 *      a client person, and leaves exactly one audit row whose action starts
 *      with the acting prefix.
 *
 * The attribution assertions are the point. A row that says a named client
 * approved a delivery, or asked for a change, is a lie the audit log cannot
 * undo afterwards, which is why every opened route writes 'team_member' and the
 * client's contact id never reaches an author column.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op: string; col?: unknown; val?: unknown; parts?: unknown[] }

const state: {
  selectQueue: Row[][]
  inserts: { table: unknown; row: Row }[]
  updateSets: Row[]
  runs: unknown[]
} = { selectQueue: [], inserts: [], updateSets: [], runs: [] }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/notifications', () => ({
  notifyTeamMember: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notify-request-team', () => ({
  notifyRequestTeam: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/sanitize-rich-text', () => ({ sanitizeRichText: (v: string) => v }))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      id: 'requests.id', orgId: 'requests.orgId', title: 'requests.title',
      status: 'requests.status', assigneeId: 'requests.assigneeId',
      isInternal: 'requests.isInternal', requestNumber: 'requests.requestNumber',
      deliveredAt: 'requests.deliveredAt', updatedAt: 'requests.updatedAt',
      queueOrder: 'requests.queueOrder', type: 'requests.type',
    },
    messages: 'messages',
    contacts: { id: 'contacts.id', name: 'contacts.name', clerkUserId: 'contacts.clerkUserId' },
    requestReads: {
      id: 'requestReads.id', requestId: 'requestReads.requestId',
      userId: 'requestReads.userId', userType: 'requestReads.userType',
      lastReadAt: 'requestReads.lastReadAt',
    },
    requestSteps: 'requestSteps',
    organisations: {
      id: 'organisations.id', onboardingState: 'organisations.onboardingState',
      updatedAt: 'organisations.updatedAt',
    },
    auditLog: 'auditLog',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]): Op => ({ __op: 'and', parts }),
  asc: (col: unknown): Op => ({ __op: 'asc', col }),
  desc: (col: unknown): Op => ({ __op: 'desc', col }),
  ne: (col: unknown, val: unknown): Op => ({ __op: 'ne', col, val }),
  inArray: (col: unknown, val: unknown): Op => ({ __op: 'inArray', col, val }),
  isNull: (col: unknown): Op => ({ __op: 'isNull', col }),
  notInArray: (col: unknown, val: unknown): Op => ({ __op: 'notInArray', col, val }),
  sql: Object.assign(
    (...parts: unknown[]): Op => ({ __op: 'sql', parts }),
    { raw: (v: unknown) => v },
  ),
}))

const database = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(state.selectQueue.shift() ?? []),
        orderBy: () => ({ limit: () => Promise.resolve(state.selectQueue.shift() ?? []) }),
      }),
      limit: () => Promise.resolve(state.selectQueue.shift() ?? []),
    }),
  }),
  insert: (table: unknown) => ({
    values: (row: Row) => {
      state.inserts.push({ table, row })
      const result = Promise.resolve(undefined) as Promise<undefined> & {
        returning: () => Promise<Row[]>
      }
      result.returning = () => Promise.resolve([{ id: 'step_new', ...row }])
      return result
    },
  }),
  update: () => ({
    set: (patch: Row) => {
      state.updateSets.push(patch)
      return { where: () => Promise.resolve(undefined) }
    },
  }),
  run: (q: unknown) => {
    state.runs.push(q)
    return Promise.resolve(undefined)
  },
}

vi.mock('@/lib/db', () => ({ db: vi.fn(() => Promise.resolve(database)) }))

vi.mock('@/lib/plan-utils', () => ({ trackCanHandle: () => true }))

import { POST as messagesPost } from '@/app/api/portal/requests/[id]/messages/route'
import { PUT as capacityReorderPut } from '@/app/api/portal/capacity/reorder/route'
import { POST as reviewPost } from '@/app/api/portal/requests/[id]/review/route'
import { PATCH as requestPatch } from '@/app/api/portal/requests/[id]/route'
import { POST as readsPost } from '@/app/api/portal/requests/[id]/reads/route'
import { POST as stepsPost } from '@/app/api/portal/requests/[id]/steps/route'
import { PATCH as onboardingPatch } from '@/app/api/portal/onboarding/route'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { getPortalAuth } from '@/lib/server-auth'
import { ACTING_AUDIT_PREFIX, READ_ONLY_MESSAGE } from '@/lib/acting-as'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

const ACTING = {
  adminUserId: 'user_liam',
  adminTeamMemberId: 'tm_liam',
  adminName: 'Liam Miller',
  orgId: 'org_client',
  contactId: 'contact_primary',
}

function clientAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

/** A super admin who has passed getPortalAuth's proof and may act. */
function actingAuth(): PortalAuth {
  return {
    userId: 'user_liam',
    orgId: 'org_client',
    sessionId: 'sess_admin',
    clerkOrgId: 'org_tahi',
    impersonating: true,
    canWriteAsClient: true,
    actingAs: ACTING,
  }
}

/** A preview that has NOT been armed: the historical read-only lens. */
function previewAuth(): PortalAuth {
  return {
    userId: 'user_liam',
    orgId: 'org_client',
    sessionId: 'sess_admin',
    clerkOrgId: 'org_tahi',
    impersonating: true,
  }
}

function jsonReq(method: string, body?: Row): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const ctx = { params: Promise.resolve({ id: 'r1' }) }

const auditRows = () =>
  state.inserts.filter(i => i.table === 'auditLog').map(i => i.row)

function meta(row: Row): Record<string, unknown> {
  return JSON.parse(row.metadata as string) as Record<string, unknown>
}

const OPEN_REQUEST = {
  id: 'r1', orgId: 'org_client', title: 'Homepage', requestNumber: 7,
  status: 'client_review', assigneeId: 'tm_other',
}

beforeEach(() => {
  vi.clearAllMocks()
  state.selectQueue = []
  state.inserts = []
  state.updateSets = []
  state.runs = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

describe('POST /api/portal/requests/[id]/messages', () => {
  it('refuses a read-only preview with the exact contract string', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await messagesPost(jsonReq('POST', { body: '<p>hi</p>' }), ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(state.inserts).toHaveLength(0)
  })

  it('posts an acting reply as the studio member, never as the client contact', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[OPEN_REQUEST], [{ id: 'contact_bob', name: 'Bob' }]]

    const res = await messagesPost(jsonReq('POST', { body: '<p>on it</p>' }), ctx)
    expect(res.status).toBe(201)

    const message = state.inserts.find(i => i.table === 'messages')!.row
    expect(message.authorType).toBe('team_member')
    expect(message.authorId).toBe('tm_liam')
    // The contact the route resolved must not have become the author, and the
    // seat carried for audit context must not have either.
    expect(message.authorId).not.toBe('contact_bob')
    expect(message.authorId).not.toBe(ACTING.contactId)
    expect(message.isInternal).toBe(false)
    expect(message.orgId).toBe('org_client')
  })

  it('leaves exactly one acting audit row naming the request', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[OPEN_REQUEST], []]

    await messagesPost(jsonReq('POST', { body: '<p>on it</p>' }), ctx)

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}message.posted`)
    expect(rows[0].actorId).toBe('user_liam')
    expect(rows[0].actorType).toBe('team_member')
    expect(rows[0].entityType).toBe('request')
    expect(rows[0].entityId).toBe('r1')
    expect(meta(rows[0]).orgId).toBe('org_client')
  })

  it('writes no audit row for an ordinary client reply', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(clientAuth())
    state.selectQueue = [[OPEN_REQUEST], [{ id: 'contact_bob', name: 'Bob' }]]

    await messagesPost(jsonReq('POST', { body: '<p>hello</p>' }), ctx)

    const message = state.inserts.find(i => i.table === 'messages')!.row
    expect(message.authorType).toBe('contact')
    expect(message.authorId).toBe('contact_bob')
    expect(auditRows()).toHaveLength(0)
  })
})

describe('POST /api/portal/requests/[id]/review', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await reviewPost(jsonReq('POST', { decision: 'approve' }), ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(state.updateSets).toHaveLength(0)
  })

  it('records an acting approval as the studio, with the decision in the audit row', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[OPEN_REQUEST], [{ id: 'contact_bob' }]]

    const res = await reviewPost(
      jsonReq('POST', { decision: 'approve', note: 'looks good' }),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(state.updateSets[0].status).toBe('delivered')

    const message = state.inserts.find(i => i.table === 'messages')!.row
    expect(message.authorType).toBe('team_member')
    expect(message.authorId).toBe('tm_liam')

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}review.submitted`)
    expect(meta(rows[0]).decision).toBe('approve')
    expect(meta(rows[0]).nextStatus).toBe('delivered')
  })

  it('records an acting change request too', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[OPEN_REQUEST], []]

    await reviewPost(jsonReq('POST', { decision: 'changes', note: 'one tweak' }), ctx)

    expect(state.updateSets[0].status).toBe('in_progress')
    expect(meta(auditRows()[0]).decision).toBe('changes')
  })
})

describe('PATCH /api/portal/requests/[id]', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await requestPatch(jsonReq('PATCH', { status: 'delivered' }), ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
  })

  it('lets an acting super admin close a delivery, and says who did', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[OPEN_REQUEST]]

    const res = await requestPatch(jsonReq('PATCH', { status: 'delivered' }), ctx)
    expect(res.status).toBe(200)
    expect(state.updateSets[0].status).toBe('delivered')

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}request.approved`)
    expect(meta(rows[0]).from).toBe('client_review')
    expect(meta(rows[0]).to).toBe('delivered')
  })

  it('still refuses any transition other than delivered while acting', async () => {
    // Act as client widens WHO may write, never WHAT may be written.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    const res = await requestPatch(jsonReq('PATCH', { status: 'in_progress' }), ctx)
    expect(res.status).toBe(400)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('POST /api/portal/requests/[id]/reads', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await readsPost(jsonReq('POST'), ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
  })

  it('stamps the STUDIO member as the reader, not a client receipt', async () => {
    // Faking the client's receipt would clear an unread badge nobody looked at.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[{ id: 'r1' }], []]

    const res = await readsPost(jsonReq('POST'), ctx)
    expect(res.status).toBe(200)

    const read = state.inserts.find(i => i.table === schema.requestReads)!.row
    expect(read.userType).toBe('team_member')
    expect(read.userId).toBe('tm_liam')
    expect(auditRows()[0].action).toBe(`${ACTING_AUDIT_PREFIX}request.read`)
  })

  it('keeps writing a contact receipt for a real client', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(clientAuth())
    state.selectQueue = [[{ id: 'r1' }], []]

    await readsPost(jsonReq('POST'), ctx)

    const read = state.inserts.find(i => i.table === schema.requestReads)!.row
    expect(read.userType).toBe('contact')
    expect(read.userId).toBe('user_client')
    expect(auditRows()).toHaveLength(0)
  })
})

describe('POST /api/portal/requests/[id]/steps', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await stepsPost(jsonReq('POST', { title: 'Step one' }), ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
  })

  it('creates an acting step as team_member', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[{ id: 'r1' }]]

    const res = await stepsPost(jsonReq('POST', { title: 'Step one' }), ctx)
    expect(res.status).toBe(201)

    const step = state.inserts.find(i => i.table === 'requestSteps')!.row
    expect(step.createdByType).toBe('team_member')
    expect(step.createdById).toBe('tm_liam')
    expect(auditRows()[0].action).toBe(`${ACTING_AUDIT_PREFIX}request_step.created`)
  })
})

describe('PUT /api/portal/capacity/reorder', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await capacityReorderPut(jsonReq('PUT', { requestIds: ['r1', 'r2'] }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(state.updateSets).toHaveLength(0)
  })

  it('reorders on the client behalf and records it, because no row holds an author', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[{ id: 'r1', type: 'small_task' }], [{ id: 'r2', type: 'small_task' }]]

    const res = await capacityReorderPut(jsonReq('PUT', { requestIds: ['r1', 'r2'] }))
    expect(res.status).toBe(200)
    expect(state.updateSets.map(u => u.queueOrder)).toEqual([0, 1])

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}queue.reordered`)
    expect(rows[0].entityType).toBe('organisation')
    expect(meta(rows[0]).requestIds).toEqual(['r1', 'r2'])
  })

  it('still refuses a request that is not the client own', async () => {
    // Act as client widens who may reorder, never whose queue may be reordered.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[]]
    const res = await capacityReorderPut(jsonReq('PUT', { requestIds: ['r_other'] }))
    expect(res.status).toBe(403)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('PATCH /api/portal/onboarding', () => {
  it('refuses a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await onboardingPatch(jsonReq('PATCH', { step: 'brief', completed: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
  })

  it('records the acting write, because the row itself holds no actor', async () => {
    // organisations.onboarding_state is a JSON blob with no author column at
    // all, so without the audit row there would be no trace whatsoever that
    // the studio ticked a client's first-run step.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    state.selectQueue = [[{ onboardingState: '{}' }]]

    const res = await onboardingPatch(jsonReq('PATCH', { step: 'brief', completed: true }))
    expect(res.status).toBe(200)

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}onboarding.step_set`)
    expect(rows[0].entityType).toBe('organisation')
    expect(rows[0].entityId).toBe('org_client')
    expect(meta(rows[0]).step).toBe('brief')
    expect(meta(rows[0]).completed).toBe(true)
  })
})
