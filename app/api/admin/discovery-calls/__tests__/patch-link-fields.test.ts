/**
 * PATCH /api/admin/discovery-calls/[id]: link + purpose field coverage.
 *
 * Covers the orgId / leadId / dealId / requestId relink (nullable clear,
 * existence validation, 400s) and the meetingType vocabulary check, plus
 * the audit_log row a change to any of those (or title) should leave.
 *
 * Also covers access-scoping on a relink: a scoped team member must not be
 * able to relink a call onto (or off of) a client outside their scope
 * through this route. `resolveAccessScoping` is mocked directly (not the
 * queries it would make), so a scoped/unrestricted decision never touches
 * the fake D1 queue below, only the route's own lookups do. Mirrors the
 * mocking pattern in app/api/admin/calls/__tests__/patch-link-fields.test.ts.
 *
 * The fake D1 is a queue-based chainable recorder: each call the route
 * makes to select/insert/update shifts the next queued result off the
 * front, in the exact order the route issues them. See
 * app/api/__tests__/admin-scoping-routes.test.ts for the pattern this
 * mirrors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn(),
}))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/discovery-calls/[id]/route'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself.
// ---------------------------------------------------------------------------
type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, calls: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[][] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const calls: QueryRecord[] = [{ method, args }]
    queries.push(calls)
    return makeChain(queue.length ? queue.shift() : [], calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/discovery-calls/call-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const baseCall = {
  id: 'call-1',
  leadId: null,
  dealId: null,
  requestId: null,
  taskId: null,
  orgId: null,
  title: 'Discovery call',
  meetingType: 'discovery',
  status: 'scheduled',
  outcome: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Unrestricted by default so every pre-existing test in this file keeps
  // exercising the validation/audit paths without a scoping denial getting
  // in the way. Tests that specifically cover scoping override this.
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

describe('PATCH /api/admin/discovery-calls/[id], link fields', () => {
  it('404s an unknown call before validating anything', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ meetingType: 'client' }), params('nope'))
    expect(res.status).toBe(404)
  })

  it('400s an invalid meetingType instead of writing it', async () => {
    const { handle, queries } = makeDb([[baseCall]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ meetingType: 'bogus' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('meetingType')
    // Only the existing-call lookup ran, no update, no audit insert.
    expect(queries).toHaveLength(1)
  })

  it('400s an orgId that does not reference an existing organisation', async () => {
    const { handle, queries } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org_nope' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('orgId')
    // Existing-call lookup + the failed org lookup, never reaches update.
    expect(queries).toHaveLength(2)
  })

  it('400s a leadId that does not reference an existing lead', async () => {
    const { handle } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ leadId: 'lead_nope' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('leadId')
  })

  it('400s a dealId that does not reference an existing deal', async () => {
    const { handle } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ dealId: 'deal_nope' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('dealId')
  })

  it('400s a requestId that does not reference an existing request', async () => {
    const { handle } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ requestId: 'req_nope' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('requestId')
  })

  it('clears a link with null without ever querying the referenced table', async () => {
    const withLead = { ...baseCall, leadId: 'lead_1' }
    const { handle, queries } = makeDb([[withLead], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ leadId: null }), params('call-1'))
    expect(res.status).toBe(200)
    // Existing-call select, the update, and the audit insert, never a
    // leads-table lookup for a null clear.
    expect(queries).toHaveLength(3)
    expect(queries[1][0].method).toBe('update')
    expect(queries[2][0].method).toBe('insert')
  })

  it('relinks org, lead, deal and request together when every id exists', async () => {
    const { handle, queries } = makeDb([
      [baseCall],  // existing call
      [{ id: 'org_1' }],
      [{ id: 'lead_1' }],
      [{ id: 'deal_1' }],
      [{ id: 'req_1' }],
      [],          // update
      [],          // audit insert
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({
      orgId: 'org_1', leadId: 'lead_1', dealId: 'deal_1', requestId: 'req_1',
    }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(7)
    const updateCall = queries[5].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({
      orgId: 'org_1', leadId: 'lead_1', dealId: 'deal_1', requestId: 'req_1',
    })
  })

  it('writes an audit_log row recording before/after when meetingType and title change', async () => {
    const { handle, queries } = makeDb([[baseCall], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ meetingType: 'client', title: 'Renamed call' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(3)
    const insertCall = queries[2].find(c => c.method === 'values')
    const row = insertCall?.args[0] as { action: string; entityType: string; entityId: string; metadata: string }
    expect(row.action).toBe('discovery_call_updated')
    expect(row.entityType).toBe('discovery_call')
    expect(row.entityId).toBe('call-1')
    const metadata = JSON.parse(row.metadata) as { changes: Record<string, { before: unknown; after: unknown }> }
    expect(metadata.changes.meetingType).toEqual({ before: 'discovery', after: 'client' })
    expect(metadata.changes.title).toEqual({ before: 'Discovery call', after: 'Renamed call' })
  })

  it('does not write an audit row when nothing audited actually changed', async () => {
    const { handle, queries } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    // Same meetingType as already stored, no real change, no audit insert.
    const res = await PATCH(req({ meetingType: 'discovery', summary: 'A note' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(2)
    expect(queries[1][0].method).toBe('update')
  })
})

describe('PATCH /api/admin/discovery-calls/[id], access scoping on a relink', () => {
  it('403s a relink to an org outside the caller scope', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const { handle, queries } = makeDb([[baseCall], [{ id: 'org_b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org_b' }), params('call-1'))
    expect(res.status).toBe(403)
    // Existing-call lookup + the org-exists lookup, never reaches update.
    expect(queries).toHaveLength(2)
  })

  it('403s a relink to a deal belonging to an org outside the caller scope', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const { handle, queries } = makeDb([[baseCall], [{ id: 'deal_1', orgId: 'org_b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ dealId: 'deal_1' }), params('call-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(2)
  })

  it('403s a relink to a request belonging to an org outside the caller scope', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const { handle, queries } = makeDb([[baseCall], [{ id: 'req_1', orgId: 'org_b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ requestId: 'req_1' }), params('call-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(2)
  })

  it('403s editing the link fields of a call that already belongs to an org outside the caller scope', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const otherOrgCall = { ...baseCall, orgId: 'org_b' }
    const { handle, queries } = makeDb([[otherOrgCall], [{ id: 'lead_1' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    // Every id in the patch is perfectly valid (lead_1 exists) - the call
    // itself belonging to an out-of-scope org must still deny.
    const res = await PATCH(req({ leadId: 'lead_1' }), params('call-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(2)
  })

  it('allows an unrestricted admin to relink a call across orgs', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(null)
    const { handle, queries } = makeDb([[baseCall], [{ id: 'org_b' }], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org_b' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(4)
  })

  it('allows linking to a lead (no organisation) even when the caller is scope-restricted', async () => {
    // Leads carry no orgId column at all, so a lead link is pre-client:
    // the "allow unless the caller has zero access at all" rule applies,
    // same as the /calls index (see app/api/admin/calls/index/route.ts).
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org_a'])
    const { handle, queries } = makeDb([[baseCall], [{ id: 'lead_1' }], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ leadId: 'lead_1' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(4)
  })

  it('403s linking to a lead when the caller has zero access at all', async () => {
    // Deny-by-default: a caller with no access rule configured cannot
    // touch this call at all, even a fully pre-client one.
    vi.mocked(resolveAccessScoping).mockResolvedValue([])
    const { handle, queries } = makeDb([[baseCall], [{ id: 'lead_1' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ leadId: 'lead_1' }), params('call-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(2)
  })
})
