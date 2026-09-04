/**
 * Route-level proof for audit item T1.16: the money and client-data admin
 * routes now enforce the caller's ROLE, not just their Tahi-org membership.
 * Before this, 246 of 364 admin route files gated on org membership alone, so
 * any seat could read financial health, exports, reports, leads, deals and
 * clients by fetching the endpoint directly. The nav hid them; the API did not.
 *
 * A representative sample is exercised end to end: the resolver is mocked, but
 * `requireFeature` and the real `decideFeature` run, so the 403 (or the pass)
 * is produced by the actual guard wiring in each route file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  resolvePermissions: vi.fn(),
}))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

import { db } from '@/lib/db'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { NextRequest } from 'next/server'

import { GET as exportInvoices } from '@/app/api/admin/export/invoices/route'
import { GET as exportTime } from '@/app/api/admin/export/time/route'
import { GET as exportLeads } from '@/app/api/admin/export/leads/route'
import { GET as leadsList } from '@/app/api/admin/leads/route'
import { GET as clientDetail } from '@/app/api/admin/clients/[id]/route'
import { GET as reportsOverview } from '@/app/api/admin/reports/overview/route'

// ── fake D1: every chain resolves to no rows ────────────────────────────────

function makeDb() {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve([]).then(ok, err)
      }
      if (typeof prop !== 'string') return undefined
      return () => chain
    },
  })
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    all: async () => [],
    run: async () => ({}),
  }
}

// ── access fixtures ─────────────────────────────────────────────────────────

function base(): ResolvedAccess {
  return {
    userId: 'user_member',
    orgId: 'org_tahi',
    level: 'team_member',
    audience: 'team',
    isSuperAdmin: false,
    isAdmin: false,
    canManagePermissions: false,
    viewableResources: new Set<string>(),
    overrides: new Map(),
  }
}

function asRoleless() {
  vi.mocked(resolvePermissions).mockResolvedValue(base())
}

function asSuperAdmin() {
  vi.mocked(resolvePermissions).mockResolvedValue({
    ...base(),
    level: 'super_admin',
    isSuperAdmin: true,
    isAdmin: true,
    canManagePermissions: true,
    viewableResources: null,
  })
}

function asTaskHandler() {
  vi.mocked(resolvePermissions).mockResolvedValue({
    ...base(),
    viewableResources: new Set(['tasks', 'requests', 'time_entries']),
  })
}

const req = (url: string) => new NextRequest('http://localhost:3000' + url)
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ['GET /api/admin/export/invoices', () => exportInvoices(req('/api/admin/export/invoices'))],
  ['GET /api/admin/export/time', () => exportTime(req('/api/admin/export/time'))],
  ['GET /api/admin/export/leads', () => exportLeads(req('/api/admin/export/leads'))],
  ['GET /api/admin/leads', () => leadsList(req('/api/admin/leads'))],
  ['GET /api/admin/reports/overview', () => reportsOverview(req('/api/admin/reports/overview'))],
  ['GET /api/admin/clients/[id]', () => clientDetail(req('/api/admin/clients/org-1'), params('org-1'))],
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db).mockResolvedValue(makeDb() as never)
})

describe('money and client-data admin routes enforce role', () => {
  it('403s a roleless team member on every one of them', async () => {
    asRoleless()
    for (const [name, call] of ROUTES) {
      const res = await call()
      expect(res.status, name).toBe(403)
      expect(await res.json(), name).toEqual({ error: 'Forbidden' })
    }
  })

  it('403s a scoped task handler on the money and CRM routes', async () => {
    asTaskHandler()
    // time_entries is in their baseline, so the time export is theirs to run.
    expect((await exportTime(req('/api/admin/export/time'))).status).not.toBe(403)
    // Invoices, leads and clients are not.
    expect((await exportInvoices(req('/api/admin/export/invoices'))).status).toBe(403)
    expect((await leadsList(req('/api/admin/leads'))).status).toBe(403)
    expect((await clientDetail(req('/api/admin/clients/org-1'), params('org-1'))).status).toBe(403)
  })

  it('never blocks a super admin', async () => {
    asSuperAdmin()
    for (const [name, call] of ROUTES) {
      const res = await call()
      expect(res.status, name).not.toBe(403)
    }
  })
})
