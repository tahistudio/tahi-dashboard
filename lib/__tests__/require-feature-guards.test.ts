/**
 * Route guards for granular permissions (audit items T1.16, T1.17, T1.18).
 *
 * Two claims are load-bearing and are asserted here rather than assumed:
 *   1. DENY BY DEFAULT. A Tahi-org team member with no active role holds an
 *      EMPTY viewable set and `requireFeature` refuses them on every key, money
 *      or not, mapped or unknown. The builder now says so too.
 *   2. SUPER ADMINS ARE UNAFFECTED. The studio owner and the MCP service token
 *      pass every check, on the admin side and on the portal side, so a
 *      permissions change can never lock the studio out of its own data.
 *
 * `requireFeature` runs against a mocked resolver but the REAL `decideFeature`,
 * so the decision itself is the thing under test. `requirePortalFeature` runs
 * against a scripted fake drizzle so the real client resolution (org row, then
 * contact refinement) is exercised end to end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  resolvePermissions: vi.fn(),
}))

import { db } from '@/lib/db'
import { resolvePermissions, holdsNoGrant, type ResolvedAccess } from '@/lib/permissions'
import { requireFeature, requirePortalFeature } from '@/lib/require-feature'

const TAHI_ORG = 'org_tahi'
const CLIENT_ORG = 'org-client-1'

// ── access fixtures ──────────────────────────────────────────────────────────

function base(): ResolvedAccess {
  return {
    userId: 'user_1',
    orgId: TAHI_ORG,
    level: 'team_member',
    audience: 'team',
    isSuperAdmin: false,
    isAdmin: false,
    canManagePermissions: false,
    viewableResources: new Set<string>(),
    overrides: new Map(),
  }
}

/** The new hire nobody has given a role yet. */
const roleless = (): ResolvedAccess => base()

/** A scoped handler: tasks, requests and time only. */
const taskHandler = (): ResolvedAccess => ({
  ...base(),
  viewableResources: new Set(['tasks', 'requests', 'time_entries']),
})

const owner = (): ResolvedAccess => ({
  ...base(),
  level: 'super_admin',
  isSuperAdmin: true,
  isAdmin: true,
  canManagePermissions: true,
  viewableResources: null,
})

// ── fake drizzle for the client (portal) path ────────────────────────────────

type Row = Record<string, unknown>

function makeDrizzle(queues: Map<unknown, Row[][]>) {
  const nextFor = (table: unknown): Row[] => {
    const q = queues.get(table)
    return q && q.length ? (q.shift() as Row[]) : []
  }
  const chain = (rows: Row[]) => {
    const p = Promise.resolve(rows)
    const c: Record<string, unknown> = {}
    for (const m of ['where', 'innerJoin', 'leftJoin', 'limit', 'orderBy']) c[m] = () => c
    c.then = (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) => p.then(res, rej)
    return c
  }
  return { select: () => ({ from: (table: unknown) => chain(nextFor(table)) }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
  vi.mocked(db).mockResolvedValue(makeDrizzle(new Map()) as never)
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
})

// ── holdsNoGrant (pure) ──────────────────────────────────────────────────────

describe('holdsNoGrant', () => {
  it('is true only for an EMPTY viewable set (the roleless marker)', () => {
    expect(holdsNoGrant(roleless())).toBe(true)
  })

  it('is false for a null viewable set (unrestricted: admin, client, service)', () => {
    expect(holdsNoGrant(owner())).toBe(false)
    expect(holdsNoGrant({ viewableResources: null })).toBe(false)
  })

  it('is false once a role grants anything at all', () => {
    expect(holdsNoGrant(taskHandler())).toBe(false)
  })
})

// ── requireFeature (admin routes) ────────────────────────────────────────────

describe('requireFeature', () => {
  const auth = { userId: 'user_1', orgId: TAHI_ORG }

  it('refuses a roleless team member on a money route', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    const denied = await requireFeature(auth, 'financial_reports')
    expect(denied).not.toBeNull()
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual({ error: 'Forbidden' })
  })

  it('refuses a roleless team member on client data too', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    for (const key of ['clients', 'invoices', 'deals', 'leads', 'reports']) {
      const denied = await requireFeature(auth, key)
      expect(denied?.status, key).toBe(403)
    }
  })

  it('refuses a roleless team member even on a key with no role resource', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    // 'overview' carries no FEATURE_RESOURCE mapping: deny by default still wins.
    expect((await requireFeature(auth, 'overview'))?.status).toBe(403)
  })

  it('lets a super admin through every key (un-lockable)', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(owner())
    for (const key of ['financial_reports', 'clients', 'invoices', 'deals', 'leads', 'settings']) {
      expect(await requireFeature(auth, key), key).toBeNull()
    }
  })

  it('lets the MCP service token through without reading the database', async () => {
    const denied = await requireFeature({ userId: 'api-service', orgId: TAHI_ORG }, 'financial_reports')
    expect(denied).toBeNull()
    expect(db).not.toHaveBeenCalled()
    expect(resolvePermissions).not.toHaveBeenCalled()
  })

  it('gates a scoped handler by their role baseline, not by org membership', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(taskHandler())
    expect(await requireFeature(auth, 'requests')).toBeNull()
    expect((await requireFeature(auth, 'financial_reports'))?.status).toBe(403)
    expect((await requireFeature(auth, 'clients'))?.status).toBe(403)
  })

  it('requires EVERY key when handed several, on one resolution', async () => {
    // The shape /api/admin/derive-billing needs: client data AND money.
    vi.mocked(resolvePermissions).mockResolvedValue({
      ...base(),
      viewableResources: new Set(['organisations', 'requests']),
    })
    expect(await requireFeature(auth, ['clients', 'requests'])).toBeNull()
    expect((await requireFeature(auth, ['clients', 'financial_reports']))?.status).toBe(403)
    expect(resolvePermissions).toHaveBeenCalledTimes(2) // one per call, not one per key
  })

  it('separates financial_reports from the operational reports resource', async () => {
    // Seed 0078 gives project_manager and viewer reports.view. Cash, MRR and
    // runway must not ride along on it.
    vi.mocked(resolvePermissions).mockResolvedValue({
      ...base(),
      viewableResources: new Set(['reports']),
    })
    expect(await requireFeature(auth, 'reports')).toBeNull()
    expect((await requireFeature(auth, 'financial_reports'))?.status).toBe(403)
  })
})

// ── requirePortalFeature (portal routes) ─────────────────────────────────────

describe('requirePortalFeature', () => {
  const clientAuth = { userId: 'user-client-1', orgId: CLIENT_ORG, clerkOrgId: 'clerk-org-client' }

  function withRows(orgRows: Row[], contactRows: Row[] = [], contactOverrides: Row[] = []) {
    const queues = new Map<unknown, Row[][]>([
      // The resolver normalises whatever org id it is handed to the D1 id first
      // (this row), then reads the override tables against that id.
      [schema.organisations, [[{ id: CLIENT_ORG, clerkOrgId: 'clerk-org-client' }]]],
      [schema.featureVisibility, [orgRows, contactOverrides]],
      [schema.contacts, [contactRows]],
    ])
    vi.mocked(db).mockResolvedValue(makeDrizzle(queues) as never)
  }

  it('refuses a client whose org is denied the feature', async () => {
    withRows([{ featureKey: 'requests', effect: 'deny' }])
    const denied = await requirePortalFeature(clientAuth, 'requests')
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual({ error: 'Forbidden' })
  })

  it('cascades an ancestor deny to a child feature', async () => {
    withRows([{ featureKey: 'requests', effect: 'deny' }])
    expect((await requirePortalFeature(clientAuth, 'requests.board'))?.status).toBe(403)
  })

  it('allows a client with no override row (client features are on by default)', async () => {
    withRows([])
    expect(await requirePortalFeature(clientAuth, 'requests')).toBeNull()
  })

  it('lets a per-contact allow lift the org deny for that person', async () => {
    withRows(
      [{ featureKey: 'invoices', effect: 'deny' }],
      [{ id: 'contact-1' }],
      [{ featureKey: 'invoices', effect: 'allow' }],
    )
    expect(await requirePortalFeature(clientAuth, 'invoices')).toBeNull()
  })

  it('never narrows the studio: a Tahi-org caller passes without a lookup', async () => {
    withRows([{ featureKey: 'requests', effect: 'deny' }])
    const admin = { userId: 'user_owner', orgId: CLIENT_ORG, clerkOrgId: TAHI_ORG, impersonating: true }
    expect(await requirePortalFeature(admin, 'requests')).toBeNull()
    expect(db).not.toHaveBeenCalled()
  })

  it('never narrows the MCP service token', async () => {
    withRows([{ featureKey: 'requests', effect: 'deny' }])
    const service = { userId: 'api-service', orgId: CLIENT_ORG, clerkOrgId: null }
    expect(await requirePortalFeature(service, 'requests')).toBeNull()
    expect(db).not.toHaveBeenCalled()
  })
})
