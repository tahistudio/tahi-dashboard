/**
 * Shared navigation model for the app shell.
 *
 * Single source of truth for the sidebar rail, the mobile bottom tabs + "More"
 * sheet, and the top-bar breadcrumb, so the three surfaces never drift. Pure
 * data + a pure `filterNav` (no hooks) so any component can apply its own
 * audience / permission context.
 */

import {
  Inbox, Users, CreditCard, FileText, Clock, CheckSquare,
  BarChart2, BookOpen, UserCog, MessageSquare,
  FolderOpen, ShoppingBag, LayoutDashboard, Star, TrendingUp,
  FileSignature, Gauge, Calendar, Megaphone, UserPlus, Share2, Phone,
  PenLine, Map, Handshake,
} from 'lucide-react'
import { featureKeyForRoute } from '@/lib/feature-tree'
import type * as React from 'react'

export type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
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
      { label: 'Overview',  href: '/overview',  icon: LayoutDashboard },
      { label: 'Requests',  href: '/requests',  icon: Inbox },
      { label: 'Tasks',     href: '/tasks',     icon: CheckSquare },
      { label: 'Messages',  href: '/messages',  icon: MessageSquare },
    ],
  },
  {
    group: 'Sales',
    items: [
      { label: 'Leads',           href: '/leads',           icon: UserPlus,      adminOnly: true },
      { label: 'Calls',           href: '/calls',           icon: Phone,         adminOnly: true },
      { label: 'Deals',           href: '/deals',           icon: TrendingUp,    adminOnly: true },
      { label: 'Proposals',       href: '/proposals',       icon: FileText,      adminOnly: true },
      { label: 'Schedules',       href: '/schedules',       icon: Calendar,      adminOnly: true },
      { label: 'Contracts',       href: '/contracts',       icon: FileSignature, adminOnly: true },
      { label: 'Calculator',      href: '/calculator',      icon: Gauge,         adminOnly: true },
      { label: 'Sales analytics', href: '/sales-analytics', icon: BarChart2,     adminOnly: true },
      { label: 'Affiliates',      href: '/affiliates',      icon: Handshake,     adminOnly: true },
    ],
  },
  {
    group: 'Clients',
    items: [
      { label: 'Clients', href: '/clients', icon: Users, adminOnly: true },
    ],
  },
  {
    group: 'Marketing',
    items: [
      { label: 'Content studio', href: '/content-studio', icon: PenLine,   adminOnly: true },
      { label: 'Sitemap',        href: '/sitemap',        icon: Map,       adminOnly: true, emailAllowlist: SITEMAP_ALLOWLIST_EMAILS },
      { label: 'Social',         href: '/social',         icon: Share2,    adminOnly: true },
      { label: 'Reviews',        href: '/reviews',        icon: Star,      adminOnly: true },
      { label: 'Announcements',  href: '/announcements',  icon: Megaphone, adminOnly: true },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Invoices',          href: '/invoices',          icon: FileText },
      { label: 'Billing',           href: '/billing',           icon: CreditCard, adminOnly: true },
      { label: 'Time',              href: '/time',              icon: Clock,      adminOnly: true },
      { label: 'Financial reports', href: '/financial-reports', icon: BarChart2,  adminOnly: true },
      { label: 'Reports',           href: '/reports',           icon: BarChart2,  adminOnly: true },
    ],
  },
  {
    group: 'Operations',
    items: [
      { label: 'Capacity', href: '/capacity', icon: Gauge,   adminOnly: true },
      { label: 'Team',     href: '/team',     icon: UserCog, adminOnly: true },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { label: 'Docs Hub', href: '/docs', icon: BookOpen, adminOnly: true },
    ],
  },
]

export const CLIENT_NAV: NavGroup[] = [
  {
    group: 'Your project',
    items: [
      { label: 'Overview',  href: '/overview',  icon: LayoutDashboard, clientVisible: true },
      { label: 'Requests',  href: '/requests',  icon: Inbox,           clientVisible: true },
      { label: 'Messages',  href: '/messages',  icon: MessageSquare,   clientVisible: true },
      { label: 'Schedule',  href: '/schedules', icon: Calendar,        clientVisible: true },
    ],
  },
  {
    group: 'Library',
    items: [
      { label: 'Files',    href: '/files',    icon: FolderOpen,  clientOnly: true, clientVisible: true },
      { label: 'Services', href: '/services', icon: ShoppingBag, clientOnly: true, clientVisible: true },
    ],
  },
  {
    group: 'Billing',
    items: [
      { label: 'Invoices',  href: '/invoices',  icon: FileText,      clientVisible: true },
      { label: 'Contracts', href: '/contracts', icon: FileSignature, clientVisible: true },
      { label: 'Proposals', href: '/proposals', icon: FileText,      clientVisible: true },
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
