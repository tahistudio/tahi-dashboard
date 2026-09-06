/**
 * The two client lifecycle endpoints: their gates, their defaults and the
 * status code they put on each refusal.
 *
 * POST /api/admin/clients/[id]/merge and DELETE /api/admin/clients/[id] are
 * the only two irreversible doors on the clients surface, so they carry the
 * same super-admin gate as the ManyRequests import and cleanup, and they both
 * default to a dry run. The refusal LOGIC is pinned in
 * lib/org-lifecycle/__tests__; this file pins the contract around it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn().mockResolvedValue({ isSuperAdmin: true }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

// The GET and PATCH handlers in the same route file reach for these; the
// lifecycle tests never call them, but the module has to import cleanly.
vi.mock('@/lib/require-access', () => ({ requireAccessToOrg: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/billing-derivation', () => ({ applyBillingDerivation: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/org-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org-lifecycle')>()
  return {
    ...actual,
    runOrgMerge: vi.fn(),
    runOrgDelete: vi.fn(),
  }
})

import { POST as MERGE } from '@/app/api/admin/clients/[id]/merge/route'
import { DELETE } from '@/app/api/admin/clients/[id]/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import {
  OrgDeleteNameMismatch,
  OrgDeleteRefusal,
  OrgMergeRefusal,
  OrgNotFound,
  OrgNotFoundForDelete,
  runOrgDelete,
  runOrgMerge,
} from '@/lib/org-lifecycle'

type Access = Awaited<ReturnType<typeof resolvePermissions>>

const SHELL = 'org_shell'
const SURVIVOR = 'org_survivor'
const params = { params: Promise.resolve({ id: SHELL }) }

function mergeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/clients/${SHELL}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/clients/${SHELL}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const MERGE_PLAN = {
  dryRun: true,
  shell: { id: SHELL, name: 'Shell' },
  survivor: { id: SURVIVOR, name: 'Survivor' },
  tables: { requests: 2 },
  externalIds: [{ field: 'xero_contact_id', shellValue: 'xero_1', survivorValue: null, carried: true, note: 'Carried.' }],
  columns: [],
  contacts: { moved: [], folded: [], references: {} },
  warnings: [],
  applied: { rowsMoved: 0, contactsMoved: 0, contactsFolded: 0, contactReferencesRepointed: 0, orgsRemoved: 0 },
}

const DELETE_PLAN = {
  dryRun: true,
  org: { id: SHELL, name: 'Acme Widgets Test', status: 'active' },
  tables: { invoices: 6 },
  invoices: [{ id: 'inv1', number: 'INV-1', status: 'draft', totalUsd: 10, currency: 'USD', createdAt: null, stripeInvoiceId: 'in_test_1', xeroInvoiceId: null }],
  stripeCustomerId: 'cus_test_1',
  xeroContactId: null,
  warnings: [],
  applied: { rowsDeleted: 0, invoicesDeleted: 0, orgsDeleted: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
  vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Access)
  vi.mocked(runOrgMerge).mockResolvedValue(MERGE_PLAN)
  vi.mocked(runOrgDelete).mockResolvedValue(DELETE_PLAN)
})

// ── merge ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/clients/[id]/merge', () => {
  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(403)
    expect(runOrgMerge).not.toHaveBeenCalled()
  })

  it('refuses an admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Access)
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/super admin/i) })
    expect(runOrgMerge).not.toHaveBeenCalled()
  })

  it('honours the clients feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(403)
    expect(runOrgMerge).not.toHaveBeenCalled()
  })

  it('requires the survivor id', async () => {
    const res = await MERGE(mergeRequest({}), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/into is required/i) })
    expect(runOrgMerge).not.toHaveBeenCalled()
  })

  it('defaults to a dry run', async () => {
    await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(vi.mocked(runOrgMerge).mock.calls[0][1]).toMatchObject({ shellId: SHELL, survivorId: SURVIVOR, dryRun: true })
  })

  it('treats a non-false dryRun as a dry run', async () => {
    await MERGE(mergeRequest({ into: SURVIVOR, dryRun: 0 }), params)
    expect(vi.mocked(runOrgMerge).mock.calls[0][1].dryRun).toBe(true)
  })

  it('writes no audit row for a dry run', async () => {
    await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('writes an audit row carrying the counts and the ids carried', async () => {
    await MERGE(mergeRequest({ into: SURVIVOR, dryRun: false }), params)
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('client_merge')
    expect(entry.entityId).toBe(SURVIVOR)
    expect(entry.metadata?.tables).toEqual({ requests: 2 })
    expect(entry.metadata?.externalIdsCarried).toEqual([{ field: 'xero_contact_id', value: 'xero_1' }])
  })

  it('answers 404 when the shell has already been merged away', async () => {
    vi.mocked(runOrgMerge).mockRejectedValue(new OrgNotFound(SHELL))
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(404)
  })

  it('answers 400 and lists the refusals, naming the conflicting field', async () => {
    vi.mocked(runOrgMerge).mockRejectedValue(new OrgMergeRefusal([
      'Both organisations carry a different xero_contact_id (a, b).',
    ]))
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; refusals: string[] }
    expect(json.refusals[0]).toContain('xero_contact_id')
  })

  it('never leaks an internal error message', async () => {
    vi.mocked(runOrgMerge).mockRejectedValue(new Error('D1_ERROR: no such column secret_thing'))
    const res = await MERGE(mergeRequest({ into: SURVIVOR }), params)
    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).not.toContain('secret_thing')
  })
})

// ── delete ───────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/clients/[id]', () => {
  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(403)
    expect(runOrgDelete).not.toHaveBeenCalled()
  })

  it('refuses an admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Access)
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(403)
    expect(runOrgDelete).not.toHaveBeenCalled()
  })

  it('honours the clients feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(403)
    expect(runOrgDelete).not.toHaveBeenCalled()
  })

  it('requires confirmName before it looks at anything', async () => {
    const res = await DELETE(deleteRequest({}), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/confirmName is required/i) })
    expect(runOrgDelete).not.toHaveBeenCalled()
  })

  it('defaults to a dry run', async () => {
    await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(vi.mocked(runOrgDelete).mock.calls[0][1]).toMatchObject({ orgId: SHELL, confirmName: 'Acme Widgets Test', dryRun: true })
  })

  it('treats a non-false dryRun as a dry run', async () => {
    await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test', dryRun: 'no' }), params)
    expect(vi.mocked(runOrgDelete).mock.calls[0][1].dryRun).toBe(true)
  })

  it('writes no audit row for a dry run', async () => {
    await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('writes an audit row carrying the counts and the invoice ids removed', async () => {
    await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test', dryRun: false }), params)
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('client_delete')
    expect(entry.entityId).toBe(SHELL)
    expect(entry.metadata?.tables).toEqual({ invoices: 6 })
    expect(entry.metadata?.invoices).toEqual([
      { id: 'inv1', number: 'INV-1', status: 'draft', totalUsd: 10, currency: 'USD', stripeInvoiceId: 'in_test_1', xeroInvoiceId: null },
    ])
    expect(entry.metadata?.stripeCustomerId).toBe('cus_test_1')
  })

  it('answers 400 on a name mismatch', async () => {
    vi.mocked(runOrgDelete).mockRejectedValue(new OrgDeleteNameMismatch('Acme Widgets Test'))
    const res = await DELETE(deleteRequest({ confirmName: 'acme widgets test' }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Acme Widgets Test') })
  })

  it('answers 409 and lists the refusals when the client looks real', async () => {
    vi.mocked(runOrgDelete).mockRejectedValue(new OrgDeleteRefusal([
      'Carries a ManyRequests id (77).',
      'Holds pipeline and sales rows: deals (1).',
    ]))
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(409)
    const json = await res.json() as { refusals: string[] }
    expect(json.refusals).toHaveLength(2)
  })

  it('answers 404 for an organisation that is already gone', async () => {
    vi.mocked(runOrgDelete).mockRejectedValue(new OrgNotFoundForDelete(SHELL))
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(404)
  })

  it('never leaks an internal error message', async () => {
    vi.mocked(runOrgDelete).mockRejectedValue(new Error('D1_ERROR: no such table secret_thing'))
    const res = await DELETE(deleteRequest({ confirmName: 'Acme Widgets Test' }), params)
    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).not.toContain('secret_thing')
  })
})
