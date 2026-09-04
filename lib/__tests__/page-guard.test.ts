/**
 * Page guards (audit item T1.16: only 10 of 51 dashboard pages were guarded, so
 * a scoped team member still rendered the full financial surface by typing the
 * URL). Sidebar hiding is cosmetic; these are the real gate.
 *
 * Claims under test: a roleless member is redirected off every guarded page,
 * including the ones with no FEATURE_TREE key of their own; a scoped member is
 * redirected off the features their role cannot view and kept on the ones it
 * can; a super admin is never redirected; and a resolver failure fails OPEN so
 * a permissions hiccup can never lock the studio out of the whole app.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

class RedirectError extends Error {
  constructor(public to: string) {
    super('NEXT_REDIRECT:' + to)
  }
}

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectError(to)
  }),
}))
vi.mock('@/lib/server-auth', () => ({ getServerAuth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  resolvePermissions: vi.fn(),
}))

import { getServerAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { requirePageFeature, requirePageManage, requirePageAnyGrant } from '@/lib/page-guard'

function base(): ResolvedAccess {
  return {
    userId: 'user_1',
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

const roleless = (): ResolvedAccess => base()
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

/** Run a guard and report where (if anywhere) it redirected. */
async function redirectedTo(run: () => Promise<void>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (err) {
    if (err instanceof RedirectError) return err.to
    throw err
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerAuth).mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi' } as never)
})

describe('requirePageFeature', () => {
  it('redirects a roleless team member off every guarded page', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    for (const key of ['financial_reports', 'clients', 'invoices', 'deals', 'leads', 'reports', 'requests']) {
      expect(await redirectedTo(() => requirePageFeature(key)), key).toBe('/overview')
    }
  })

  it('redirects a scoped handler off the money pages but keeps their own work', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(taskHandler())
    expect(await redirectedTo(() => requirePageFeature('financial_reports'))).toBe('/overview')
    expect(await redirectedTo(() => requirePageFeature('clients'))).toBe('/overview')
    expect(await redirectedTo(() => requirePageFeature('requests'))).toBeNull()
    expect(await redirectedTo(() => requirePageFeature('tasks'))).toBeNull()
  })

  it('never redirects a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(owner())
    for (const key of ['financial_reports', 'clients', 'invoices', 'settings']) {
      expect(await redirectedTo(() => requirePageFeature(key)), key).toBeNull()
    }
  })

  it('fails open when the resolver throws (never lock the app over a hiccup)', async () => {
    vi.mocked(resolvePermissions).mockRejectedValue(new Error('D1 unavailable'))
    expect(await redirectedTo(() => requirePageFeature('financial_reports'))).toBeNull()
  })
})

describe('requirePageAnyGrant', () => {
  it('redirects a roleless member off a page with no feature key of its own', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    expect(await redirectedTo(() => requirePageAnyGrant())).toBe('/overview')
  })

  it('lets anyone holding a grant through, including a scoped handler', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(taskHandler())
    expect(await redirectedTo(() => requirePageAnyGrant())).toBeNull()
    vi.mocked(resolvePermissions).mockResolvedValue(owner())
    expect(await redirectedTo(() => requirePageAnyGrant())).toBeNull()
  })

  it('lets a client through (their grant is unrestricted on the client side)', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({
      ...base(),
      level: 'client',
      audience: 'client',
      viewableResources: null,
    })
    expect(await redirectedTo(() => requirePageAnyGrant())).toBeNull()
  })
})

describe('requirePageManage', () => {
  it('redirects a roleless member and a scoped handler, admits an admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue(roleless())
    expect(await redirectedTo(() => requirePageManage())).toBe('/overview')
    vi.mocked(resolvePermissions).mockResolvedValue(taskHandler())
    expect(await redirectedTo(() => requirePageManage())).toBe('/overview')
    vi.mocked(resolvePermissions).mockResolvedValue(owner())
    expect(await redirectedTo(() => requirePageManage())).toBeNull()
  })
})
