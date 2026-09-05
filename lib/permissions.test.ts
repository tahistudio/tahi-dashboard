import { describe, it, expect, beforeEach } from 'vitest'
import {
  decideFeature,
  featureMap,
  resolvePermissions,
  type ResolvedAccess,
  type Effect,
} from '@/lib/permissions'
import { schema } from '@/db/d1'
import { ADMIN_NAV, CLIENT_NAV, filterNav, type NavGroup } from '@/components/tahi/nav-model'

// Build a ResolvedAccess for a given level. `overrides` is a plain object for brevity.
function access(
  level: ResolvedAccess['level'],
  opts: {
    overrides?: Record<string, Effect>
    viewableResources?: string[] | null
    audience?: ResolvedAccess['audience']
  } = {},
): ResolvedAccess {
  const audience = opts.audience ?? (level === 'client' ? 'client' : 'team')
  return {
    userId: 'u', orgId: 'o', level, audience,
    isSuperAdmin: level === 'super_admin',
    isAdmin: level === 'super_admin' || level === 'admin',
    canManagePermissions: level === 'super_admin' || level === 'admin',
    viewableResources: opts.viewableResources === undefined ? null : (opts.viewableResources ? new Set(opts.viewableResources) : null),
    overrides: new Map(Object.entries(opts.overrides ?? {})),
  }
}

describe('decideFeature — levels', () => {
  it('super_admin sees every team feature, even with a deny override (un-lockable)', () => {
    const a = access('super_admin', { overrides: { requests: 'deny', tasks: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'settings.permissions')).toBe(true)
  })

  it('admin sees team features by default, but a deny override hides one', () => {
    const a = access('admin')
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'financial_reports')).toBe(true)
    const denied = access('admin', { overrides: { financial_reports: 'deny' } })
    expect(decideFeature(denied, 'financial_reports')).toBe(false)
  })

  it('client sees client-audience features by default but NOT team-only ones', () => {
    const a = access('client')
    expect(decideFeature(a, 'requests')).toBe(true)   // shared audience
    expect(decideFeature(a, 'invoices')).toBe(true)   // shared
    expect(decideFeature(a, 'tasks')).toBe(false)     // team-only
    expect(decideFeature(a, 'financial_reports')).toBe(false) // team-only
    expect(decideFeature(a, 'team')).toBe(false)      // team-only
  })

  it('per-org deny hides a feature from a client', () => {
    const a = access('client', { overrides: { invoices: 'deny' } })
    expect(decideFeature(a, 'invoices')).toBe(false)
    expect(decideFeature(a, 'requests')).toBe(true)
  })

  it('team_member only sees features their role can .view (role baseline)', () => {
    // A task_handler-style role: can view requests + tasks, not invoices/deals.
    const a = access('team_member', { viewableResources: ['requests', 'tasks', 'time_entries', 'docs'] })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'invoices')).toBe(false) // no invoices.view
    expect(decideFeature(a, 'deals')).toBe(false)    // no deals.view
  })

  it('team_member: an allow override grants a feature the role baseline would deny', () => {
    const a = access('team_member', { viewableResources: ['requests'], overrides: { deals: 'allow' } })
    expect(decideFeature(a, 'deals')).toBe(true)
  })

  it('team_member: ungated features (no resource mapping) are allowed by default', () => {
    const a = access('team_member', { viewableResources: ['requests'] })
    // 'overview' and 'messages' have no FEATURE_RESOURCE mapping.
    expect(decideFeature(a, 'overview')).toBe(true)
    expect(decideFeature(a, 'messages')).toBe(true)
  })
})

describe('decideFeature - deny by default (no grant)', () => {
  // An EMPTY viewable set is the "holds no grant" marker: a Tahi-org identity
  // with no active role. It must deny MORE than the role baseline does, because
  // features with no resource mapping (overview, messages) are allowed to a
  // roled team member by design.
  it('a team member with no role sees nothing at all', () => {
    const a = access('team_member', { viewableResources: [] })
    expect(decideFeature(a, 'overview')).toBe(false)   // ungated feature
    expect(decideFeature(a, 'messages')).toBe(false)   // ungated feature
    expect(decideFeature(a, 'requests')).toBe(false)   // gated feature
    expect(decideFeature(a, 'clients')).toBe(false)
    expect(decideFeature(a, 'settings')).toBe(false)
    expect(decideFeature(a, 'settings.permissions')).toBe(false)
    expect(decideFeature(a, 'some.unknown.key')).toBe(false) // not even unknown keys
  })

  it('an explicit allow override still grants a single feature (a grant, not a default)', () => {
    const a = access('team_member', { viewableResources: [], overrides: { requests: 'allow' } })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'requests.board')).toBe(true) // inherits the parent allow
    expect(decideFeature(a, 'clients')).toBe(false)       // everything else stays denied
  })

  it('deny-all never reaches admin+ or clients (their viewable set is null)', () => {
    expect(decideFeature(access('super_admin'), 'overview')).toBe(true)
    expect(decideFeature(access('admin'), 'overview')).toBe(true)
    expect(decideFeature(access('client'), 'overview')).toBe(true)
  })
})

describe('decideFeature — ancestry cascade', () => {
  it('denying a parent cascades to a child with no own rule', () => {
    const a = access('admin', { overrides: { requests: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(false)       // inherits parent deny
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })

  it('a child-specific rule beats the parent (most-specific wins)', () => {
    const a = access('admin', { overrides: { requests: 'deny', 'requests.board': 'allow' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(true) // own allow beats parent deny
  })
})

describe('decideFeature — edges', () => {
  it('unknown feature keys are not gated (allow)', () => {
    const a = access('client')
    expect(decideFeature(a, 'some.unknown.key')).toBe(true)
  })

  it('a team-only sub-feature is denied to clients even with an allow override', () => {
    // requests.bulk_actions is team-only; audience check precedes overrides.
    const a = access('client', { overrides: { 'requests.bulk_actions': 'allow' } })
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolvePermissions: the DB-backed level decision.
//
// This is where deny by default lives. The old resolver ended with
// `else level = 'admin'`, so a Tahi-org user with no role assigned WAS a full
// admin. These tests pin the new order and, just as importantly, the two
// identities that must never be caught by it: the MCP service token and an
// unseeded workspace.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type StubDb = Parameters<typeof resolvePermissions>[0]

/**
 * Minimal drizzle stub: select().from(table) pops the next queued result set
 * for that table and the chain is thenable, so `await q.where(...)`,
 * `await q.where(...).limit(1)` and `.innerJoin(...)` all resolve.
 */
function makeDb(queues: Map<unknown, Row[][]>, tablesSeen: unknown[]): StubDb {
  function chainFor(rows: Row[]) {
    const chain: Record<string, unknown> = {}
    chain.innerJoin = () => chain
    chain.limit = () => chain
    chain.where = () => chain
    chain.then = (
      resolve: (value: Row[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        tablesSeen.push(table)
        const queue = queues.get(table) ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    }),
  } as unknown as StubDb
}

function seedTeam(opts: {
  member?: Row[]
  /** Rows for the member's own ACTIVE role assignments. */
  memberRoles?: Row[]
  /** Rows for the bootstrap probe: any active assignment in the workspace. */
  anyActiveRole?: Row[]
  viewPerms?: Row[]
}): { db: StubDb; tablesSeen: unknown[] } {
  // team_member_roles is queried twice on the roleless path (own roles, then
  // the bootstrap probe) and the own-roles query is skipped entirely when no
  // member row matched, so queue in exactly that order.
  const roleQueue: Row[][] = []
  if ((opts.member ?? []).length > 0) roleQueue.push(opts.memberRoles ?? [])
  roleQueue.push(opts.anyActiveRole ?? [])

  const queues = new Map<unknown, Row[][]>([
    [schema.teamMembers, [opts.member ?? []]],
    [schema.teamMemberRoles, roleQueue],
    [schema.rolePermissions, [opts.viewPerms ?? []]],
    [schema.featureVisibility, [[], []]],
  ])
  const tablesSeen: unknown[] = []
  return { db: makeDb(queues, tablesSeen), tablesSeen }
}

describe('resolvePermissions - deny by default', () => {
  const TAHI = 'org_tahi_test'

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI
  })

  it('a Tahi-org member with NO role sees nothing (the new hire case)', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_hire', role: 'member' }],
      memberRoles: [],
      anyActiveRole: [{ id: 'tmr_someone_else' }], // workspace IS seeded
    })
    const resolved = await resolvePermissions(db, { userId: 'user_hire', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
    expect(resolved.isSuperAdmin).toBe(false)
    expect(resolved.canManagePermissions).toBe(false)
    expect(resolved.viewableResources?.size).toBe(0)
    expect(Object.values(featureMap(resolved)).some(Boolean)).toBe(false)
  })

  it('a Tahi-org login with no roster row at all is denied', async () => {
    const { db } = seedTeam({ member: [], anyActiveRole: [{ id: 'tmr_someone_else' }] })
    const resolved = await resolvePermissions(db, { userId: 'user_stranger', orgId: TAHI })

    expect(resolved.isAdmin).toBe(false)
    expect(resolved.viewableResources?.size).toBe(0)
    expect(Object.values(featureMap(resolved)).some(Boolean)).toBe(false)
  })

  it('an ended role does not grant: no active assignment means denied', async () => {
    // The endedAt filter lives in the query (asserted in
    // lib/__tests__/access-scoping-resolve.test.ts); here the DB returns no
    // active rows and the member must fall to deny, not to the old admin.
    const { db } = seedTeam({
      member: [{ id: 'tm_ex_admin', role: 'admin' }],
      memberRoles: [],
      anyActiveRole: [{ id: 'tmr_someone_else' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_ex_admin', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
  })

  it('BOOTSTRAP: an unseeded workspace (no active assignment anywhere) keeps admin', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_owner', role: 'admin' }],
      memberRoles: [],
      anyActiveRole: [], // nothing seeded: a fresh install must not lock out
    })
    const resolved = await resolvePermissions(db, { userId: 'user_owner', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
  })

  it('the MCP service token stays full admin without reading any table', async () => {
    const { db, tablesSeen } = seedTeam({ anyActiveRole: [{ id: 'tmr_someone_else' }] })
    const resolved = await resolvePermissions(db, { userId: 'api-service', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.canManagePermissions).toBe(true)
    expect(resolved.viewableResources).toBeNull()
    expect(tablesSeen).toEqual([]) // no bootstrap probe, no role lookup
    expect(decideFeature(resolved, 'financial_reports')).toBe(true)
  })

  it('THE OWNER: super_admin resolves to super_admin and stays unrestricted', async () => {
    const { db } = seedTeam({
      member: [{ id: 'b3025c04-6cdd-4154-822c-5d4fbfb95b76', role: 'admin' }],
      memberRoles: [{ roleId: 'role-super-admin', name: 'super_admin' }],
      anyActiveRole: [{ id: 'tmr_superadmin_liam' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_liam', orgId: TAHI })

    expect(resolved.level).toBe('super_admin')
    expect(resolved.isSuperAdmin).toBe(true)
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
    // Every TEAM feature stays on (client-only nodes are off by audience, not
    // by permission, which is why this is not a blanket every(Boolean)).
    const map = featureMap(resolved)
    for (const key of ['overview', 'requests', 'clients', 'financial_reports', 'team', 'settings', 'settings.permissions']) {
      expect(map[key]).toBe(true)
    }
  })

  it('an admin role resolves to admin and stays unrestricted', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_admin', role: 'member' }],
      memberRoles: [{ roleId: 'role-admin', name: 'admin' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_admin', orgId: TAHI })

    expect(resolved.level).toBe('admin')
    expect(resolved.isAdmin).toBe(true)
    expect(resolved.viewableResources).toBeNull()
  })

  it('a scoped role gets exactly its own view baseline, not deny-all', async () => {
    const { db } = seedTeam({
      member: [{ id: 'tm_handler', role: 'member' }],
      memberRoles: [{ roleId: 'role-task-handler', name: 'task_handler' }],
      viewPerms: [{ resource: 'requests' }, { resource: 'tasks' }],
    })
    const resolved = await resolvePermissions(db, { userId: 'user_handler', orgId: TAHI })

    expect(resolved.level).toBe('team_member')
    expect(resolved.isAdmin).toBe(false)
    expect(resolved.viewableResources).toEqual(new Set(['requests', 'tasks']))
    expect(decideFeature(resolved, 'requests')).toBe(true)
    expect(decideFeature(resolved, 'tasks')).toBe(true)
    expect(decideFeature(resolved, 'invoices')).toBe(false)
    expect(decideFeature(resolved, 'financial_reports')).toBe(false)
    // A role that holds a grant keeps the ungated surfaces it always had.
    expect(decideFeature(resolved, 'overview')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Audit T1.18: adminOnly nav gating + the newly mapped admin surfaces, and the
// V1 messaging hide. filterNav is pure, so the nav model is tested directly.
// ---------------------------------------------------------------------------

function navHrefs(nav: NavGroup[]): string[] {
  return nav.flatMap(g => g.items.map(i => i.href))
}

describe('filterNav - adminOnly gating (audit T1.18)', () => {
  const base = {
    showAsAdmin: true,
    isViewerRole: false,
    userEmail: null,
    canManagePermissions: false,
  }
  const ADMIN_ONLY_HREFS = ADMIN_NAV.flatMap(g => g.items).filter(i => i.adminOnly).map(i => i.href)

  it('the model actually carries adminOnly items (guards the fixture)', () => {
    expect(ADMIN_ONLY_HREFS.length).toBeGreaterThanOrEqual(15)
    for (const href of ['/billing', '/capacity', '/affiliates', '/content-studio', '/social', '/reviews', '/announcements']) {
      expect(ADMIN_ONLY_HREFS).toContain(href)
    }
  })

  it('hides every adminOnly item from a non-admin team member (showAsAdmin alone is not enough)', () => {
    const visible = navHrefs(filterNav(ADMIN_NAV, { ...base, isEffectiveAdmin: false }))
    for (const href of ADMIN_ONLY_HREFS) expect(visible).not.toContain(href)
    // Non-adminOnly workspace items survive for a roled team member.
    expect(visible).toContain('/overview')
    expect(visible).toContain('/requests')
    expect(visible).toContain('/tasks')
  })

  it('shows adminOnly items to an admin-level viewer (sitemap stays email-gated)', () => {
    const visible = navHrefs(filterNav(ADMIN_NAV, { ...base, isEffectiveAdmin: true, canManagePermissions: true }))
    for (const href of ADMIN_ONLY_HREFS.filter(h => h !== '/sitemap')) {
      expect(visible).toContain(href)
    }
    expect(visible).not.toContain('/sitemap') // email allowlist, userEmail is null here
  })

  it('a features-map deny still hides a mapped item from an admin-level viewer', () => {
    const visible = navHrefs(filterNav(ADMIN_NAV, {
      ...base, isEffectiveAdmin: true, features: { billing: false },
    }))
    expect(visible).not.toContain('/billing')
    expect(visible).toContain('/capacity')
  })
})

describe('nav model - messaging hidden for V1', () => {
  it('neither nav set carries a /messages item', () => {
    expect(navHrefs(ADMIN_NAV)).not.toContain('/messages')
    expect(navHrefs(CLIENT_NAV)).not.toContain('/messages')
  })

  it('the client nav keeps everything else', () => {
    const visible = navHrefs(filterNav(CLIENT_NAV, {
      showAsAdmin: false, isEffectiveAdmin: false, isViewerRole: false,
      userEmail: null, canManagePermissions: false,
    }))
    expect(visible).toEqual([
      '/overview', '/requests', '/notifications',
      '/files', '/services',
      '/invoices',
    ])
  })
})

// ---------------------------------------------------------------------------
// Ship-readiness Tier 1 item 10: no client nav item may bounce. /schedules,
// /contracts and /proposals redirect a client back to /requests, so they must
// stay out of CLIENT_NAV until their pages grow a client branch.
// ---------------------------------------------------------------------------

describe('client nav - no dead ends (Tier 1 item 10)', () => {
  const CLIENT_ONLY_REDIRECTS = ['/schedules', '/contracts', '/proposals']

  it('carries none of the routes whose page redirects a client', () => {
    for (const href of CLIENT_ONLY_REDIRECTS) {
      expect(navHrefs(CLIENT_NAV)).not.toContain(href)
    }
  })

  it('every client nav href is a page that renders for a client session', () => {
    // Kept as an explicit allowlist so adding a nav entry forces a decision
    // about whether the page actually has a client branch.
    const CLIENT_RENDERABLE = new Set([
      '/overview', '/requests', '/files', '/services', '/invoices', '/billing',
      // Rows are keyed on the caller's own Clerk user id, so the page and its
      // API are self-scoping: no org gate, nothing to bounce.
      '/notifications',
    ])
    for (const href of navHrefs(CLIENT_NAV)) {
      expect(CLIENT_RENDERABLE.has(href)).toBe(true)
    }
  })
})

describe('decideFeature - newly mapped admin surfaces (audit T1.18)', () => {
  const NEW_KEYS = ['billing', 'capacity', 'content_studio', 'social', 'reviews', 'announcements', 'affiliates']

  it('denies a task_handler-style role and a roleless member; allows admin and super_admin', () => {
    const handler = access('team_member', {
      viewableResources: ['tasks', 'requests', 'time_entries', 'messages', 'docs', 'activities'],
    })
    const roleless = access('team_member', { viewableResources: [] })
    for (const key of NEW_KEYS) {
      expect(decideFeature(handler, key)).toBe(false)
      expect(decideFeature(roleless, key)).toBe(false)
      expect(decideFeature(access('admin'), key)).toBe(true)
      expect(decideFeature(access('super_admin'), key)).toBe(true)
    }
  })

  it('a viewer-style role (view on the whole seeded catalogue) gets exactly the catalogued two', () => {
    // The seeded permission catalogue has affiliates + announcements rows but
    // none for billing / capacity / content_studio / social / reviews, so even
    // view-on-everything cannot reach those five.
    const viewer = access('team_member', {
      viewableResources: [
        'leads', 'deals', 'contacts', 'people', 'organisations', 'requests', 'tasks',
        'messages', 'files', 'time_entries', 'invoices', 'contracts', 'proposals',
        'schedules', 'calls', 'activities', 'docs', 'subscribers', 'campaigns',
        'affiliates', 'reports', 'sales_analytics', 'settings', 'team',
        'integrations', 'calculator', 'announcements',
      ],
    })
    expect(decideFeature(viewer, 'affiliates')).toBe(true)
    expect(decideFeature(viewer, 'announcements')).toBe(true)
    for (const key of ['billing', 'capacity', 'content_studio', 'social', 'reviews']) {
      expect(decideFeature(viewer, key)).toBe(false)
    }
  })

  it('an explicit allow override still grants one of them to a team member', () => {
    const a = access('team_member', { viewableResources: ['tasks'], overrides: { reviews: 'allow' } })
    expect(decideFeature(a, 'reviews')).toBe(true)
    expect(decideFeature(a, 'social')).toBe(false)
  })
})
