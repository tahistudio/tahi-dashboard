/**
 * POST /api/portal/requests: who the row says filed it.
 *
 * Two things are being fixed at once here, and they are easy to confuse.
 *
 * The BUG: this route wrote `submitted_by_id` = the raw Clerk user id and left
 * `submitted_by_type` at its 'contact' column default, so the pair has always
 * lied about real client submissions. The id in that column was never a
 * contacts.id, which is what 'contact' claims it is.
 *
 * The FEATURE: a super admin acting for a client files as the studio member
 * (submitted_by_type 'team_member'), which is the same pair the admin-side
 * sub-request route already writes, and leaves an audit row saying so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedSql { strings: string[]; values: unknown[] }

const captured: {
  runArgs: CapturedSql[]
  selectResults: unknown[]
  inserts: { table: unknown; row: Record<string, unknown> }[]
  /** Simulate a D1 hiccup on the audit insert, to prove the ordering. */
  auditThrows: boolean
} = { runArgs: [], selectResults: [], inserts: [], auditThrows: false }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/sanitize-rich-text', () => ({ sanitizeRichText: (s: string) => s }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/notifications', () => ({ notifyAllAdmins: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/notification-email', () => ({
  studioNewRequestEmailPlan: vi.fn((plan: unknown) => plan),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    subscriptions: { orgId: 'org_id', status: 'status', planType: 'plan_type', hasPrioritySupport: 'has_priority_support' },
    organisations: { id: 'id', name: 'name', tracksMode: 'tracks_mode', customSmallTracks: 'custom_small_tracks', customLargeTracks: 'custom_large_tracks' },
    requests: { id: 'id', orgId: 'org_id', requestNumber: 'request_number', isInternal: 'is_internal', status: 'status', createdAt: 'created_at', queueOrder: 'queue_order' },
    contacts: { id: 'id', name: 'name', orgId: 'org_id', clerkUserId: 'clerk_user_id' },
    brandContacts: { contactId: 'contact_id', brandId: 'brand_id', createdAt: 'created_at' },
    brands: { id: 'id', orgId: 'org_id' },
    auditLog: 'auditLog',
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    }),
    eq: stub, and: stub, ne: stub, asc: stub, desc: stub,
    inArray: stub, notInArray: stub,
  }
})

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['leftJoin', 'where', 'orderBy', 'offset', 'from']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() =>
    Promise.resolve(captured.selectResults.length ? captured.selectResults.shift() : []),
  )
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: (row: Record<string, unknown>) => {
          if (table === 'auditLog' && captured.auditThrows) {
            return Promise.reject(new Error('D1 unavailable'))
          }
          captured.inserts.push({ table, row })
          return Promise.resolve(undefined)
        },
      })),
      run: vi.fn((arg: CapturedSql) => {
        captured.runArgs.push(arg)
        return Promise.resolve({ meta: {} })
      }),
    }),
  }
})

import { POST } from '@/app/api/portal/requests/route'
import { NextRequest } from 'next/server'
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

function clientAuth(): PortalAuth {
  return {
    userId: 'user_client', orgId: 'org_client', sessionId: 's',
    clerkOrgId: 'org_client', impersonating: false,
  }
}

function actingAuth(): PortalAuth {
  return {
    userId: 'user_liam', orgId: 'org_client', sessionId: 's',
    clerkOrgId: 'org_tahi', impersonating: true,
    canWriteAsClient: true, actingAs: ACTING,
  }
}

function previewAuth(): PortalAuth {
  return {
    userId: 'user_liam', orgId: 'org_client', sessionId: 's',
    clerkOrgId: 'org_tahi', impersonating: true,
  }
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The INSERT skeleton, and the value bound at a named column position. */
function insertColumns(): string {
  return captured.runArgs[0].strings.join('')
}

const auditRows = () =>
  captured.inserts.filter(i => i.table === 'auditLog').map(i => i.row)

beforeEach(() => {
  vi.clearAllMocks()
  captured.runArgs = []
  captured.selectResults = []
  captured.inserts = []
  captured.auditThrows = false
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
})

describe('POST /api/portal/requests attribution', () => {
  it('names both submitter columns in the insert', () => {
    // Guards the shape the two cases below bind values into. Leaving
    // submitted_by_type out of the column list is exactly how the old lie
    // survived: the default filled it in with something untrue.
    vi.mocked(getPortalAuth).mockResolvedValue(clientAuth())
    return POST(makeRequest({ title: 'A thing' })).then(() => {
      expect(insertColumns()).toContain('submitted_by_id, submitted_by_type')
    })
  })

  it('files a real client submission as their contacts row, typed contact', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(clientAuth())
    captured.selectResults = [
      [{ id: 'contact_bob', name: 'Bob' }],   // loadSubmitter
      [],                                     // brand links
      [{ requestNumber: 3 }],                 // read back
      [{ name: 'Acme' }],                     // org name
    ]

    const res = await POST(makeRequest({ title: 'A thing' }))
    expect(res.status).toBe(201)

    const values = captured.runArgs[0].values
    expect(values).toContain('contact_bob')
    expect(values).toContain('contact')
    // The Clerk user id must no longer be what lands in that column.
    expect(values).not.toContain('user_client')
    expect(auditRows()).toHaveLength(0)
  })

  it('files an acting submission as the studio member, typed team_member', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    captured.selectResults = [
      [{ requestNumber: 4 }],
      [{ name: 'Acme' }],
    ]

    const res = await POST(makeRequest({ title: 'Filed on the call' }))
    expect(res.status).toBe(201)

    const values = captured.runArgs[0].values
    expect(values).toContain('tm_liam')
    expect(values).toContain('team_member')
    // Neither the admin's Clerk id nor the client's seat may end up as the
    // submitter: one is not a roster id, the other would forge a client.
    expect(values).not.toContain('user_liam')
    expect(values).not.toContain('contact_primary')
  })

  it('records the acting submission once, with the request it created', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    captured.selectResults = [[{ requestNumber: 4 }], [{ name: 'Acme' }]]

    await POST(makeRequest({ title: 'Filed on the call', category: 'design' }))

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}request.created`)
    expect(rows[0].actorId).toBe('user_liam')
    expect(rows[0].entityType).toBe('request')
    const meta = JSON.parse(rows[0].metadata as string) as Record<string, unknown>
    expect(meta.title).toBe('Filed on the call')
    expect(meta.category).toBe('design')
    expect(meta.orgId).toBe('org_client')
    expect(meta.placement).toBe('queue')
    expect(meta.priority).toBe('standard')
    // The per-org number is assigned by the INSERT's own subquery, so it does
    // not exist when the record is written. The entity id is the handle.
    expect(rows[0].entityId).toBe(captured.runArgs[0].values[0])
  })

  it('writes the record BEFORE the request row', async () => {
    // Ordering is the whole guarantee. Recorded afterwards, a failed audit
    // insert returned a 500 on a request that had already landed in the
    // client's workspace, and the operator's retry filed a duplicate under
    // their name. This way a failed record leaves nothing behind.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    captured.selectResults = [[{ requestNumber: 4 }], [{ name: 'Acme' }]]

    captured.auditThrows = true
    await expect(POST(makeRequest({ title: 'Filed on the call' }))).rejects.toThrow()

    // Nothing was inserted into `requests`: the INSERT never ran.
    expect(captured.runArgs).toHaveLength(0)
  })

  it('leaves the client queue alone when the record fails on a top placement', async () => {
    // 'top' renumbers every other open request in the org before the insert.
    // The record therefore has to sit above that too, or a failed record could
    // reshuffle a client's queue for a request that was never filed.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    captured.selectResults = [[{ requestNumber: 4 }], [{ name: 'Acme' }]]
    captured.auditThrows = true

    await expect(POST(makeRequest({ title: 'Urgent', placement: 'top' }))).rejects.toThrow()

    // No UPDATE and no INSERT: `run` is the only path either takes.
    expect(captured.runArgs).toHaveLength(0)
  })


  it('refuses a read-only preview before touching anything', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await POST(makeRequest({ title: 'x' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(captured.runArgs).toHaveLength(0)
    expect(auditRows()).toHaveLength(0)
  })

  it('ignores a brand id that is not this org, while acting', async () => {
    // The acting path cannot read a brand off the submitter's own links, so it
    // validates against the org instead. An unvalidated id would file a
    // request under another tenant's brand.
    vi.mocked(getPortalAuth).mockResolvedValue(actingAuth())
    captured.selectResults = [
      [],                        // resolveOrgBrandId: no brand matches org + id
      [{ requestNumber: 5 }],
      [{ name: 'Acme' }],
    ]

    await POST(makeRequest({ title: 'x', brandId: 'brand_from_elsewhere' }))

    expect(captured.runArgs[0].values).not.toContain('brand_from_elsewhere')
  })
})
