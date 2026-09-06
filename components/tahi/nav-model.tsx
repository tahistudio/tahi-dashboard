/**
 * Shared navigation model for the app shell.
 *
 * Single source of truth for the sidebar rail, the mobile bottom tabs + "More"
 * sheet, and the top-bar breadcrumb, so the three surfaces never drift. Pure
 * data + a pure `filterNav` (no hooks) so any component can apply its own
 * audience / permission context. Icons are ShellIcon names (the design's exact
 * icon set, see components/tahi/shell-icons.tsx), not Lucide components.
 */

import { featureKeyForRoute } from '@/lib/feature-tree'
import type { ShellIconName } from '@/components/tahi/shell-icons'

export type NavItem = {
  label: string
  href: string
  icon: ShellIconName
  adminOnly?: boolean
  clientOnly?: boolean
  clientVisible?: boolean
  /** Hidden unless current user's email is in this allowlist. */
  emailAllowlist?: Set<string>
  /** Hidden unless the user can manage permissions (admin / super admin). */
  requiresManage?: boolean
  /**
   * Client audience only: hidden from a plain member seat at a client org.
   * Money surfaces (/invoices, /billing) are gated server-side to workspace
   * admins of the org (lib/portal-access.ts, enforced by /api/portal/invoices),
   * so offering a member the nav item only buys them a 403.
   */
  requiresOrgAdmin?: boolean
  count?: number
}

export type NavGroup = {
  group: string
  items: NavItem[]
}

// Emails allowed to see the /sitemap nav entry. The page itself is also
// 404-gated server-side - this is purely UX (no broken link for the team).
export const SITEMAP_ALLOWLIST_EMAILS = new Set(['business@tahi.studio', 'staci@tahi.studio'])

// In viewer-role impersonation, these admin pages are hidden.
export const VIEWER_HIDDEN_PAGES = new Set(['/team', '/billing', '/contracts'])

export const ADMIN_NAV: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', href: '/overview', icon: 'overview' },
      { label: 'Requests', href: '/requests', icon: 'requests' },
      { label: 'Tasks',    href: '/tasks',    icon: 'tasks' },
      // The page behind the bell. Self-scoping (rows are keyed on the caller's
      // Clerk user id), so it serves both audiences from one route.
      { label: 'Notifications', href: '/notifications', icon: 'bell' },
      // The studio inbox: every client's standing line and every request
      // thread, over one reader (lib/messages-store.ts). Gated on the
      // `messages` FEATURE_TREE key, the same one the client branch is.
      { label: 'Messages', href: '/messages', icon: 'messages' },
    ],
  },
  {
    group: 'Sales',
    items: [
      { label: 'Leads',           href: '/leads',           icon: 'leads',          adminOnly: true },
      { label: 'Calls',           href: '/calls',           icon: 'calls',          adminOnly: true },
      { label: 'Deals',           href: '/deals',           icon: 'deals',          adminOnly: true },
      { label: 'Proposals',       href: '/proposals',       icon: 'proposals',      adminOnly: true },
      { label: 'Schedules',       href: '/schedules',       icon: 'schedules',      adminOnly: true },
      { label: 'Contracts',       href: '/contracts',       icon: 'contracts',      adminOnly: true },
      { label: 'Calculator',      href: '/calculator',      icon: 'calculator',     adminOnly: true },
      { label: 'Sales analytics', href: '/sales-analytics', icon: 'salesanalytics', adminOnly: true },
      { label: 'Affiliates',      href: '/affiliates',      icon: 'affiliates',     adminOnly: true },
    ],
  },
  {
    group: 'Clients',
    items: [
      { label: 'Clients', href: '/clients', icon: 'clients', adminOnly: true },
    ],
  },
  {
    group: 'Marketing',
    items: [
      { label: 'Content studio', href: '/content-studio', icon: 'content',       adminOnly: true },
      { label: 'Sitemap',        href: '/sitemap',        icon: 'sitemap',       adminOnly: true, emailAllowlist: SITEMAP_ALLOWLIST_EMAILS },
      { label: 'Social',         href: '/social',         icon: 'social',        adminOnly: true },
      { label: 'Reviews',        href: '/reviews',        icon: 'reviews',       adminOnly: true },
      { label: 'Announcements',  href: '/announcements',  icon: 'announcements', adminOnly: true },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Invoices',          href: '/invoices',          icon: 'invoices' },
      { label: 'Billing',           href: '/billing',           icon: 'billing',          adminOnly: true },
      { label: 'Time',              href: '/time',              icon: 'time',             adminOnly: true },
      { label: 'Financial reports', href: '/financial-reports', icon: 'financialreports', adminOnly: true },
      { label: 'Reports',           href: '/reports',           icon: 'reports',          adminOnly: true },
    ],
  },
  {
    group: 'Operations',
    items: [
      { label: 'Capacity', href: '/capacity', icon: 'capacity', adminOnly: true },
      { label: 'Team',     href: '/team',     icon: 'team',     adminOnly: true },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { label: 'Docs Hub', href: '/docs', icon: 'docs', adminOnly: true },
    ],
  },
]

/**
 * The client rail. Every entry here MUST resolve to a page that renders for a
 * client session: a nav item that bounces is worse than no nav item at all.
 *
 * Removed 2026-09-05 because their pages redirect a client straight back to
 * /requests (no client branch exists yet): Schedule (/schedules), Contracts
 * (/contracts), Proposals (/proposals). They are Tier 3 client surfaces; add
 * the entry back in the same commit that gives the page a client branch.
 */
export const CLIENT_NAV: NavGroup[] = [
  {
    group: 'Your project',
    items: [
      { label: 'Overview', href: '/overview',  icon: 'overview',  clientVisible: true },
      { label: 'Requests', href: '/requests',  icon: 'requests',  clientVisible: true },
      // The page behind the bell. Rows are keyed on the caller's own Clerk user
      // id, so the route needs no org gate and never bounces a client.
      { label: 'Notifications', href: '/notifications', icon: 'bell', clientVisible: true },
      // Their line to the studio, plus a thread per request. Same page, same
      // feature key, client branch (see app/(dashboard)/messages/page.tsx).
      { label: 'Messages', href: '/messages', icon: 'messages', clientVisible: true },
    ],
  },
  {
    group: 'Library',
    items: [
      { label: 'Files',    href: '/files',    icon: 'files',    clientOnly: true, clientVisible: true },
      { label: 'Services', href: '/services', icon: 'services', clientOnly: true, clientVisible: true },
    ],
  },
  {
    group: 'Billing',
    items: [
      // Workspace admins of the client org only: /api/portal/invoices 403s a
      // member seat, so the whole Billing group drops for them.
      { label: 'Invoices', href: '/invoices', icon: 'invoices', clientVisible: true, requiresOrgAdmin: true },
    ],
  },
]

export interface FilterNavOpts {
  showAsAdmin: boolean
  /** Admin or super_admin permission LEVEL (PermissionsValue.isAdmin), NOT
   *  Tahi-org membership: showAsAdmin is true for every team login, so a
   *  scoped team member must not pass this. Gates `adminOnly` items. */
  isEffectiveAdmin: boolean
  isViewerRole: boolean
  userEmail: string | null
  canManagePermissions: boolean
  features?: Record<string, boolean>
  /**
   * The client seat, resolved server-side from the caller's contacts row
   * (ResolvedAccess.portalRole). Gates `requiresOrgAdmin` items.
   *
   * 'member' is the ONLY value that hides anything. null / undefined means the
   * seat is unknown (a team session, an admin previewing a client portal, a
   * contact row that has not been linked yet) and must fail OPEN, because the
   * portal routes let impersonation read and a wrongly hidden item is a second
   * dead end rather than a fix.
   */
  clientPortalRole?: 'admin' | 'member' | null
}

/** Apply audience + permission visibility to a nav model. Empty groups drop. */
export function filterNav(nav: NavGroup[], opts: FilterNavOpts): NavGroup[] {
  const { showAsAdmin, isEffectiveAdmin, isViewerRole, userEmail, canManagePermissions, features, clientPortalRole } = opts
  return nav
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        if (item.emailAllowlist && (!userEmail || !item.emailAllowlist.has(userEmail))) return false
        if (item.requiresManage && !canManagePermissions) return false
        if (item.adminOnly && !isEffectiveAdmin) return false
        if (features) {
          const key = featureKeyForRoute(item.href)
          if (key && features[key] === false) return false
        }
        if (showAsAdmin) {
          if (item.clientOnly) return false
          if (isViewerRole && VIEWER_HIDDEN_PAGES.has(item.href)) return false
          return true
        }
        if (!item.clientVisible) return false
        if (item.requiresOrgAdmin && clientPortalRole === 'member') return false
        return true
      }),
    }))
    .filter(group => group.items.length > 0)
}

/** Active-route detection shared by the rail + mobile tabs. Some routes are
 *  exact-match only, the rest prefix-match. */
const EXACT_ONLY = new Set(['/requests', '/overview', '/proposals'])
export function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || (!EXACT_ONLY.has(href) && pathname.startsWith(href))
}

/** Resolve the top-bar breadcrumb (group / page) for a pathname. */
export function resolveCrumb(pathname: string, isAdmin: boolean): { group: string; label: string } {
  const nav = isAdmin ? ADMIN_NAV : CLIENT_NAV
  for (const g of nav) {
    for (const it of g.items) {
      if (pathname === it.href || pathname.startsWith(it.href + '/')) {
        return { group: g.group, label: it.label }
      }
    }
  }
  if (pathname.startsWith('/settings')) return { group: '', label: 'Settings' }
  if (pathname.startsWith('/permissions')) return { group: 'Settings', label: 'Permissions' }
  const seg = pathname.split('/').filter(Boolean)[0] ?? ''
  const label = seg ? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ') : 'Overview'
  return { group: '', label }
}
