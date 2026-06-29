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

export const CLIENT_NAV: NavGroup[] = [
  {
    group: 'Your project',
    items: [
      { label: 'Overview', href: '/overview',  icon: 'overview',  clientVisible: true },
      { label: 'Requests', href: '/requests',  icon: 'requests',  clientVisible: true },
      { label: 'Messages', href: '/messages',  icon: 'messages',  clientVisible: true },
      { label: 'Schedule', href: '/schedules', icon: 'schedules', clientVisible: true },
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
      { label: 'Invoices',  href: '/invoices',  icon: 'invoices',  clientVisible: true },
      { label: 'Contracts', href: '/contracts', icon: 'contracts', clientVisible: true },
      { label: 'Proposals', href: '/proposals', icon: 'proposals', clientVisible: true },
    ],
  },
]

export interface FilterNavOpts {
  showAsAdmin: boolean
  isViewerRole: boolean
  userEmail: string | null
  canManagePermissions: boolean
  features?: Record<string, boolean>
}

/** Apply audience + permission visibility to a nav model. Empty groups drop. */
export function filterNav(nav: NavGroup[], opts: FilterNavOpts): NavGroup[] {
  const { showAsAdmin, isViewerRole, userEmail, canManagePermissions, features } = opts
  return nav
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        if (item.emailAllowlist && (!userEmail || !item.emailAllowlist.has(userEmail))) return false
        if (item.requiresManage && !canManagePermissions) return false
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
