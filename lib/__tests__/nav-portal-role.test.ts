import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CLIENT_NAV, ADMIN_NAV, filterNav, type NavGroup } from '@/components/tahi/nav-model'
import { resolvePermissions } from '@/lib/permissions'
import { schema } from '@/db/d1'

/**
 * CT.6: the client rail must not offer a member seat an item the portal API
 * refuses. /api/portal/invoices 403s anyone who is not a workspace admin of
 * their own org (lib/portal-access.ts), so the nav reads the same seat from the
 * same contacts row and drops the Billing group for a member.
 *
 * The invariant that matters most here is the FAIL-OPEN one: only an explicit
 * 'member' hides anything. An unknown seat (team session, a Tahi admin
 * previewing a portal, an unlinked contact) must keep the item, because
 * impersonation is allowed to read invoices and a wrongly hidden item would be
 * a second dead end rather than a fix.
 */

function navHrefs(nav: NavGroup[]): string[] {
  return nav.flatMap(g => g.items.map(i => i.href))
}

const CLIENT_BASE = {
  showAsAdmin: false,
  isEffectiveAdmin: false,
  isViewerRole: false,
  userEmail: null,
  canManagePermissions: false,
}

describe('filterNav - client seat gating (CT.6)', () => {
  it('the client model actually marks Invoices as org-admin only (guards the fixture)', () => {
    const invoices = CLIENT_NAV.flatMap(g => g.items).find(i => i.href === '/invoices')
    expect(invoices?.requiresOrgAdmin).toBe(true)
  })

  it('hides Invoices from a member seat, and drops the now-empty Billing group', () => {
    const filtered = filterNav(CLIENT_NAV, { ...CLIENT_BASE, clientPortalRole: 'member' })
    expect(navHrefs(filtered)).not.toContain('/invoices')
    expect(filtered.map(g => g.group)).not.toContain('Billing')
    // Everything the member IS allowed survives.
    expect(navHrefs(filtered)).toEqual(['/overview', '/requests', '/notifications', '/files', '/services'])
  })

  it('keeps Invoices for an admin seat', () => {
    const visible = navHrefs(filterNav(CLIENT_NAV, { ...CLIENT_BASE, clientPortalRole: 'admin' }))
    expect(visible).toContain('/invoices')
  })

  it('fails open on an unknown seat (null, undefined, or a value we do not model)', () => {
    for (const seat of [null, undefined] as const) {
      expect(navHrefs(filterNav(CLIENT_NAV, { ...CLIENT_BASE, clientPortalRole: seat })))
        .toContain('/invoices')
    }
    // No clientPortalRole passed at all: the pre-CT.6 call shape.
    expect(navHrefs(filterNav(CLIENT_NAV, CLIENT_BASE))).toContain('/invoices')
  })

  it('never touches the admin rail, whatever seat is passed', () => {
    const before = navHrefs(filterNav(ADMIN_NAV, {
      showAsAdmin: true, isEffectiveAdmin: true, isViewerRole: false,
      userEmail: null, canManagePermissions: true,
    }))
    const after = navHrefs(filterNav(ADMIN_NAV, {
      showAsAdmin: true, isEffectiveAdmin: true, isViewerRole: false,
      userEmail: null, canManagePermissions: true, clientPortalRole: 'member',
    }))
    expect(after).toEqual(before)
    expect(after).toContain('/invoices')
    expect(after).toContain('/billing')
  })
})

// ---------------------------------------------------------------------------
// The seat itself, read by resolvePermissions from the contacts row it already
// loads for per-contact feature overrides (so the nav costs no extra query).
// Same minimal drizzle mock the contact-overrides test uses.
// ---------------------------------------------------------------------------

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
  return {
    select: () => ({ from: (table: unknown) => chain(nextFor(table)) }),
  } as unknown as Parameters<typeof resolvePermissions>[0]
}

const CLIENT_ORG = 'org-client-1'
const CLIENT_USER = 'user-client-1'
const ORG_ROW = { id: CLIENT_ORG, clerkOrgId: 'clerk-org-client-1' }

function queuesFor(contactRows: Row[]): Map<unknown, Row[][]> {
  return new Map<unknown, Row[][]>([
    [schema.featureVisibility, [[], []]],
    [schema.contacts, [contactRows]],
    [schema.organisations, [[ORG_ROW]]],
  ])
}

beforeEach(() => { process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org-tahi-admin' })
afterEach(() => { delete process.env.NEXT_PUBLIC_TAHI_ORG_ID })

describe('resolvePermissions - client portalRole (CT.6)', () => {
  it('reads an explicit admin seat', async () => {
    const access = await resolvePermissions(
      makeDrizzle(queuesFor([{ id: 'c1', portalRole: 'admin', isPrimary: 0 }])),
      { userId: CLIENT_USER, orgId: CLIENT_ORG },
    )
    expect(access.portalRole).toBe('admin')
  })

  it('treats the primary contact as an admin seat even without the role', async () => {
    const access = await resolvePermissions(
      makeDrizzle(queuesFor([{ id: 'c1', portalRole: 'member', isPrimary: 1 }])),
      { userId: CLIENT_USER, orgId: CLIENT_ORG },
    )
    expect(access.portalRole).toBe('admin')
  })

  it('reads a second seat as a member', async () => {
    const access = await resolvePermissions(
      makeDrizzle(queuesFor([{ id: 'c2', portalRole: 'member', isPrimary: 0 }])),
      { userId: CLIENT_USER, orgId: CLIENT_ORG },
    )
    expect(access.portalRole).toBe('member')
  })

  it('stays null (unknown, not member) when there is no contact row', async () => {
    const access = await resolvePermissions(
      makeDrizzle(queuesFor([])),
      { userId: CLIENT_USER, orgId: CLIENT_ORG },
    )
    expect(access.portalRole).toBeNull()
  })

  it('stays null for a team identity', async () => {
    const access = await resolvePermissions(
      makeDrizzle(new Map()),
      { userId: 'user-team-1', orgId: 'org-tahi-admin' },
    )
    expect(access.level).not.toBe('client')
    expect(access.portalRole).toBeNull()
  })
})
