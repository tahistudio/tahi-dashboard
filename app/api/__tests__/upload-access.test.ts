/**
 * Unit tests for lib/upload-access.ts: the pure serve/delete authorization
 * decision (decideUploadRead) and the org-identity resolvers used by
 * presign/confirm. Uses the real module with a hand-built fake database
 * (empty teamMembers means requireAccessToOrg resolves to unrestricted).
 */
import { describe, it, expect } from 'vitest'
import {
  decideUploadRead,
  resolveD1OrgId,
  resolveTargetOrgId,
  resolveOwnerOrgForUpload,
} from '@/lib/upload-access'
import { schema } from '@/db/d1'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function fakeDb(opts: {
  orgQueue?: Array<Array<{ id: string }>>
  requestRows?: Array<{ orgId: string }>
} = {}): DrizzleDB {
  const orgQueue = [...(opts.orgQueue ?? [])]
  const requestRows = opts.requestRows ?? []
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === schema.organisations) return orgQueue.shift() ?? []
            if (table === schema.requests) return requestRows
            return []
          },
        }),
      }),
    }),
  } as unknown as DrizzleDB
}

// ---------------------------------------------------------------------------
// decideUploadRead: requester x file-owner matrix
// ---------------------------------------------------------------------------
describe('decideUploadRead', () => {
  const base = {
    isAdmin: false,
    fileOrgId: null as string | null,
    keyOrgId: null as string | null,
    requesterClerkOrgId: 'org_clerk' as string | null,
    requesterD1OrgId: 'org_d1' as string | null,
  }

  describe('with a files row (row is the source of truth)', () => {
    it('routes admins through team-member scoping against files.orgId', () => {
      const d = decideUploadRead({ ...base, isAdmin: true, fileOrgId: 'org_d1', keyOrgId: 'ignored' })
      expect(d).toEqual({ outcome: 'admin_scope_check', targetOrgId: 'org_d1' })
    })

    it('allows a client whose D1 org matches files.orgId', () => {
      const d = decideUploadRead({ ...base, fileOrgId: 'org_d1' })
      expect(d.outcome).toBe('allow')
    })

    it('allows a client whose Clerk org matches a legacy files.orgId', () => {
      const d = decideUploadRead({ ...base, fileOrgId: 'org_clerk', requesterD1OrgId: null })
      expect(d.outcome).toBe('allow')
    })

    it('denies a client whose orgs match neither id space', () => {
      const d = decideUploadRead({ ...base, fileOrgId: 'org_other' })
      expect(d).toEqual({ outcome: 'deny', status: 403, error: 'Forbidden' })
    })

    it('denies an unprovisioned client (no D1 org) on a D1-owned row', () => {
      const d = decideUploadRead({ ...base, fileOrgId: 'org_d1', requesterD1OrgId: null })
      expect(d.outcome).toBe('deny')
    })

    it('ignores the key prefix entirely when a row exists', () => {
      const d = decideUploadRead({ ...base, fileOrgId: 'org_other', keyOrgId: 'org_d1' })
      expect(d.outcome).toBe('deny')
    })
  })

  describe('legacy fallback (no files row)', () => {
    it('rejects anon-prefixed keys', () => {
      const d = decideUploadRead({ ...base, keyOrgId: 'anon' })
      expect(d).toEqual({ outcome: 'deny', status: 400, error: 'Invalid or legacy file key' })
    })

    it('rejects keys with no org prefix', () => {
      const d = decideUploadRead({ ...base, keyOrgId: null })
      expect(d.outcome).toBe('deny')
    })

    it('routes admins through team-member scoping against the prefix', () => {
      const d = decideUploadRead({ ...base, isAdmin: true, keyOrgId: 'org_x' })
      expect(d).toEqual({ outcome: 'admin_scope_check', targetOrgId: 'org_x' })
    })

    it('allows a client whose Clerk org matches the prefix (legacy keys)', () => {
      const d = decideUploadRead({ ...base, keyOrgId: 'org_clerk' })
      expect(d.outcome).toBe('allow')
    })

    it('allows a client whose D1 org matches the prefix (new keys)', () => {
      const d = decideUploadRead({ ...base, keyOrgId: 'org_d1' })
      expect(d.outcome).toBe('allow')
    })

    it('denies a client on another org prefix', () => {
      const d = decideUploadRead({ ...base, keyOrgId: 'org_other' })
      expect(d).toEqual({ outcome: 'deny', status: 403, error: 'Forbidden' })
    })
  })
})

// ---------------------------------------------------------------------------
// Org-identity resolvers
// ---------------------------------------------------------------------------
describe('resolveD1OrgId', () => {
  it('resolves via the clerkOrgId link first', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_org' }]] })
    expect(await resolveD1OrgId(database, 'org_clerk')).toBe('d1_org')
  })

  it('falls back to the legacy id-equals-clerk-id case', async () => {
    const database = fakeDb({ orgQueue: [[], [{ id: 'org_clerk' }]] })
    expect(await resolveD1OrgId(database, 'org_clerk')).toBe('org_clerk')
  })

  it('returns null when no org matches', async () => {
    const database = fakeDb({ orgQueue: [[], []] })
    expect(await resolveD1OrgId(database, 'org_clerk')).toBeNull()
  })

  it('returns null for a null Clerk org', async () => {
    expect(await resolveD1OrgId(fakeDb(), null)).toBeNull()
  })
})

describe('resolveTargetOrgId', () => {
  it('accepts a D1 id directly', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_org' }]] })
    expect(await resolveTargetOrgId(database, 'd1_org')).toBe('d1_org')
  })

  it('tolerates a Clerk org id reference', async () => {
    const database = fakeDb({ orgQueue: [[], [{ id: 'd1_org' }]] })
    expect(await resolveTargetOrgId(database, 'org_clerk')).toBe('d1_org')
  })

  it('returns null for an unknown org', async () => {
    const database = fakeDb({ orgQueue: [[], []] })
    expect(await resolveTargetOrgId(database, 'nope')).toBeNull()
  })
})

describe('resolveOwnerOrgForUpload', () => {
  const admin = { isAdmin: true, userId: 'user_admin', callerClerkOrgId: 'org_tahi' }
  const client = { isAdmin: false, userId: 'user_client', callerClerkOrgId: 'org_clerk' }

  it('admin: explicit target org wins after validation', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_client' }]] })
    const r = await resolveOwnerOrgForUpload(database, { ...admin, targetOrgId: 'd1_client' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'd1_client' })
  })

  it('admin: unknown target org is a 400', async () => {
    const database = fakeDb({ orgQueue: [[], []] })
    const r = await resolveOwnerOrgForUpload(database, { ...admin, targetOrgId: 'nope' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })

  it('admin: a real requestId implies its org', async () => {
    const database = fakeDb({ requestRows: [{ orgId: 'd1_client' }] })
    const r = await resolveOwnerOrgForUpload(database, { ...admin, requestId: 'req_1' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'd1_client' })
  })

  it('admin: pseudo request ids fall through to the Tahi org', async () => {
    const database = fakeDb()
    const r = await resolveOwnerOrgForUpload(database, { ...admin, requestId: 'branding' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'org_tahi' })
  })

  it('client: forced to their resolved D1 org, target ignored', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_client' }]] })
    const r = await resolveOwnerOrgForUpload(database, { ...client, targetOrgId: 'd1_victim' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'd1_client' })
  })

  it('client: unprovisioned workspace is a 403', async () => {
    const database = fakeDb({ orgQueue: [[], []] })
    const r = await resolveOwnerOrgForUpload(database, client)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('client: a real request in another org is a 403', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_client' }]], requestRows: [{ orgId: 'd1_other' }] })
    const r = await resolveOwnerOrgForUpload(database, { ...client, requestId: 'req_1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })

  it('client: a request in their own org passes', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_client' }]], requestRows: [{ orgId: 'd1_client' }] })
    const r = await resolveOwnerOrgForUpload(database, { ...client, requestId: 'req_1' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'd1_client' })
  })

  it('client: pseudo request ids (org-logo) pass through', async () => {
    const database = fakeDb({ orgQueue: [[{ id: 'd1_client' }]] })
    const r = await resolveOwnerOrgForUpload(database, { ...client, requestId: 'org-logo' })
    expect(r).toEqual({ ok: true, ownerOrgId: 'd1_client' })
  })
})
