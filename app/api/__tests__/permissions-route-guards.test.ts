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
import { GET as commitmentsList } from '@/app/api/admin/commitments/route'
import { GET as subscriptionsList } from '@/app/api/admin/subscriptions/route'
import { GET as capacityRead } from '@/app/api/admin/capacity/route'
import { POST as deriveBilling } from '@/app/api/admin/derive-billing/route'

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

/**
 * The seeded project_manager / viewer shape: migration 0078 grants them
 * reports.view (viewer takes every .view row), which used to be enough to read
 * financial health because `financial_reports` shared the `reports` resource.
 */
function asOpsReporter() {
  vi.mocked(resolvePermissions).mockResolvedValue({
    ...base(),
    viewableResources: new Set(['reports', 'requests', 'tasks', 'organisations']),
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
  ['GET /api/admin/commitments', () => commitmentsList(req('/api/admin/commitments'))],
  ['GET /api/admin/subscriptions', () => subscriptionsList(req('/api/admin/subscriptions'))],
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

describe('the money routes outside the audit parenthetical', () => {
  it('403s a roleless member on commitments, subscriptions, capacity and derive-billing', async () => {
    asRoleless()
    expect((await commitmentsList(req('/api/admin/commitments'))).status).toBe(403)
    expect((await subscriptionsList(req('/api/admin/subscriptions'))).status).toBe(403)
    expect((await capacityRead(req('/api/admin/capacity?orgId=org-1'))).status).toBe(403)
    expect((await deriveBilling(req('/api/admin/derive-billing'))).status).toBe(403)
  })

  it('403s a scoped task handler on them too', async () => {
    asTaskHandler()
    expect((await commitmentsList(req('/api/admin/commitments'))).status).toBe(403)
    expect((await subscriptionsList(req('/api/admin/subscriptions'))).status).toBe(403)
    expect((await capacityRead(req('/api/admin/capacity?orgId=org-1'))).status).toBe(403)
    expect((await deriveBilling(req('/api/admin/derive-billing'))).status).toBe(403)
  })

  it('403s derive-billing for a role that can see clients but not the money', async () => {
    // It writes billingModel and retainerStartDate across every org, so it
    // needs BOTH keys: the per-client sibling clients/[id]/auto-derive gates on
    // 'clients', and it is a money operation on top.
    vi.mocked(resolvePermissions).mockResolvedValue({
      ...base(),
      viewableResources: new Set(['organisations', 'requests']),
    })
    expect((await deriveBilling(req('/api/admin/derive-billing'))).status).toBe(403)
  })
})

describe('financial_reports is not the operational reports resource', () => {
  it('lets an ops reporter read /reports but not the money surfaces', async () => {
    // The whole point of splitting the resource: seed 0078 hands reports.view
    // to project_manager and to viewer, and cash / MRR / runway is not that.
    asOpsReporter()
    expect((await reportsOverview(req('/api/admin/reports/overview'))).status).not.toBe(403)
    expect((await commitmentsList(req('/api/admin/commitments'))).status).toBe(403)
    expect((await deriveBilling(req('/api/admin/derive-billing'))).status).toBe(403)
  })
})
