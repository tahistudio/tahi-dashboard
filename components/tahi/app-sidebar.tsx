'use client'

/**
 * <AppSidebar>. The dashboard's primary navigation.
 *
 * Responsive at the core:
 *
 *   Desktop (>= 1024px) persistent cream sidebar pinned to the left.
 *     Expandable / collapsible (320ms ease-out). Collapsed width 64px
 *     shows icons only with Tooltips. Expanded width 240px shows
 *     group labels + count badges.
 *
 *   Tablet (768 to 1023px) persistent rail. Always collapsed by default,
 *     can be expanded via the top-nav hamburger.
 *
 *   Mobile (< 768px) hidden by default. Top-nav hamburger opens it as
 *     a left-edge drawer with backdrop. Focus is trapped while open.
 *     Esc + backdrop click + nav link click all close it.
 *
 * Accessibility:
 *
 *   - <nav aria-label="Primary"> on the nav region.
 *   - aria-current="page" on the active link.
 *   - aria-expanded + aria-controls on collapsible group buttons.
 *   - Visible focus ring on every interactive element (uses the
 *     global :focus-visible rule in globals.css).
 *   - Min 44x44px touch target on mobile (padding bumps).
 *   - Drawer: aria-modal="true", role="dialog", aria-labelledby on
 *     the brand heading inside. Focus trap from FocusTrap.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Inbox, Users, CreditCard, FileText, Clock, CheckSquare,
  BarChart2, BookOpen, UserCog, MessageSquare,
  FolderOpen, ShoppingBag, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Star, TrendingUp, FileSignature, Gauge,
  Calendar, Megaphone, ChevronDown, UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { useSidebar } from '@/components/tahi/sidebar-context'
import { Tooltip } from '@/components/tahi/tooltip'
import { TahiIconMark, TahiStudioWordmark } from '@/components/tahi/tahi-glyphs'
import { SidebarUserCard } from '@/components/tahi/sidebar-user-card'
import * as React from 'react'

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  clientOnly?: boolean
  clientVisible?: boolean
  count?: number
}

type NavGroup = {
  group: string
  items: NavItem[]
  /** When true, group is collapsible. Workspace stays open by default. */
  collapsible?: boolean
}

const ADMIN_NAV: NavGroup[] = [
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
    collapsible: true,
    items: [
      { label: 'Leads',              href: '/leads',               icon: UserPlus,      adminOnly: true },
      { label: 'Deals',              href: '/deals',               icon: TrendingUp,    adminOnly: true },
      { label: 'Proposals',          href: '/proposals',           icon: FileText,      adminOnly: true },
      { label: 'Schedules',          href: '/schedules',           icon: Calendar,      adminOnly: true },
      { label: 'Contracts',          href: '/contracts',           icon: FileSignature, adminOnly: true },
      { label: 'Calculator',         href: '/calculator',          icon: Gauge,         adminOnly: true },
      { label: 'Sales analytics',    href: '/sales-analytics',     icon: BarChart2,     adminOnly: true },
    ],
  },
  {
    group: 'Clients',
    collapsible: true,
    items: [
      { label: 'Clients',   href: '/clients',   icon: Users,         adminOnly: true },
    ],
  },
  {
    group: 'Marketing',
    collapsible: true,
    items: [
      { label: 'Reviews',       href: '/reviews',       icon: Star,      adminOnly: true },
      { label: 'Announcements', href: '/announcements', icon: Megaphone, adminOnly: true },
    ],
  },
  {
    group: 'Finance',
    collapsible: true,
    items: [
      { label: 'Invoices',  href: '/invoices',  icon: FileText },
      { label: 'Billing',   href: '/billing',   icon: CreditCard,    adminOnly: true },
      { label: 'Time',      href: '/time',      icon: Clock,         adminOnly: true },
      { label: 'Reports',   href: '/reports',   icon: BarChart2,     adminOnly: true },
    ],
  },
  {
    group: 'Operations',
    collapsible: true,
    items: [
      { label: 'Capacity',  href: '/capacity',  icon: Gauge,         adminOnly: true },
      { label: 'Team',      href: '/team',      icon: UserCog,       adminOnly: true },
    ],
  },
  {
    group: 'Knowledge',
    collapsible: true,
    items: [
      { label: 'Docs Hub',  href: '/docs',      icon: BookOpen,      adminOnly: true },
    ],
  },
]

const CLIENT_NAV: NavGroup[] = [
  {
    group: 'Your project',
    items: [
      { label: 'Overview',  href: '/overview',  icon: LayoutDashboard, clientVisible: true },
      { label: 'Requests',  href: '/requests',  icon: Inbox,           clientVisible: true },
      { label: 'Messages',  href: '/messages',  icon: MessageSquare,   clientVisible: true },
    ],
  },
  {
    group: 'Library',
    items: [
      { label: 'Files',     href: '/files',     icon: FolderOpen,      clientOnly: true, clientVisible: true },
      { label: 'Services',  href: '/services',  icon: ShoppingBag,     clientOnly: true, clientVisible: true },
    ],
  },
  {
    group: 'Billing',
    items: [
      { label: 'Invoices',  href: '/invoices',  icon: FileText,        clientVisible: true },
    ],
  },
]

// Sidebar widths live in CSS now (see .tahi-sidebar in globals.css).
// Inline-script sync on <html data-sidebar="collapsed"> drives the
// width before React hydrates so there's no flash on refresh.

const VIEWER_HIDDEN_PAGES = new Set(['/team', '/billing', '/contracts'])

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const { collapsed, setCollapsed } = useSidebar()
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()

  // Flag the sidebar as "ready" so user-clicked toggles can animate.
  // Defer with two requestAnimationFrame ticks so transitions are
  // guaranteed to be off across:
  //   - the initial paint
  //   - any React re-render triggered by SidebarProvider's
  //     useLayoutEffect catching up to the data-sidebar attribute
  // The inline script in app/layout.tsx already set the attribute
  // before body parsed, so the first paint shows the correct width
  // with no animation.
  React.useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.documentElement.setAttribute('data-sidebar-ready', '')
      })
    })
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      document.documentElement.removeAttribute('data-sidebar-ready')
    }
  }, [])

  // No useEffect to sync data-sidebar with React state; setCollapsed
  // writes the attribute directly so there's no second update window
  // where the attribute briefly mismatches the state.

  // Theme state. Lives here so we can pass it into the SidebarUserCard
  // menu where the toggle now sits.
  const [darkMode, setDarkMode] = React.useState(false)
  React.useEffect(() => {
    try {
      setDarkMode(localStorage.getItem('tahi-theme') === 'dark')
    } catch { /* localStorage unavailable */ }
  }, [])
  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    try {
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('tahi-theme', next ? 'dark' : 'light')
    } catch { /* localStorage unavailable */ }
  }

  // Collapsible-group state. Default: every collapsible group expanded.
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('tahi-sidebar-groups')
      if (stored) setOpenGroups(JSON.parse(stored))
    } catch { /* localStorage unavailable */ }
  }, [])
  const toggleGroup = (groupName: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [groupName]: prev[groupName] === false }
      try { localStorage.setItem('tahi-sidebar-groups', JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }
  // When the sidebar itself is collapsed (icon-only), force every group
  // visually open so the icons are always reachable. The per-group toggle
  // only applies when the sidebar is expanded and the labels are visible.
  const isGroupOpen = (g: NavGroup) =>
    collapsed || !g.collapsible || openGroups[g.group] !== false

  const showAsAdmin = isAdmin && !isImpersonatingClient
  const isViewerRole = isImpersonatingTeamMember
    && impersonatedAccessRules.length > 0
    && impersonatedAccessRules.every(r => r.role === 'viewer')

  const sourceNav = showAsAdmin ? ADMIN_NAV : CLIENT_NAV
  const visibleNav = sourceNav.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (showAsAdmin) {
        if (item.clientOnly) return false
        if (isViewerRole && VIEWER_HIDDEN_PAGES.has(item.href)) return false
        return true
      }
      if (!item.clientVisible) return false
      return true
    }),
  })).filter(group => group.items.length > 0)

  // Active route detection. Some routes use prefix-match, others exact.
  const exactOnly = new Set(['/requests', '/overview', '/proposals'])
  const isItemActive = (href: string) =>
    pathname === href || (!exactOnly.has(href) && pathname.startsWith(href))

  // Desktop sidebar. On mobile we hide it with CSS (md:flex). Mobile
  // gets the bottom-bar drawer via <MobileBottomNav>; the sidebar
  // itself stays desktop-only. Width is driven by CSS via
  // [data-sidebar="collapsed"] on <html>, set by the inline script
  // before React hydrates (see app/(dashboard)/layout.tsx).

  const sidebarContent = (
    <SidebarContent
      collapsed={collapsed}
      visibleNav={visibleNav}
      isItemActive={isItemActive}
      isGroupOpen={isGroupOpen}
      toggleGroup={toggleGroup}
      darkMode={darkMode}
      toggleDarkMode={toggleDarkMode}
      setCollapsed={setCollapsed}
    />
  )

  return (
    <aside
      className="tahi-sidebar hidden md:flex flex-col h-full flex-shrink-0"
      aria-label="Primary navigation"
      style={{
        background: 'var(--color-bg)',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      {sidebarContent}
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────
// Sidebar inner content. Shared between desktop and drawer.
// ────────────────────────────────────────────────────────────────────
interface SidebarContentProps {
  collapsed: boolean
  visibleNav: NavGroup[]
  isItemActive: (href: string) => boolean
  isGroupOpen: (g: NavGroup) => boolean
  toggleGroup: (groupName: string) => void
  darkMode: boolean
  toggleDarkMode: () => void
  setCollapsed: (next: boolean) => void
}

function SidebarContent({
  collapsed,
  visibleNav,
  isItemActive,
  isGroupOpen,
  toggleGroup,
  darkMode,
  toggleDarkMode,
  setCollapsed,
}: SidebarContentProps) {
  return (
    <>
      {/* Brand lockup. Padding + justify-content flip via CSS keyed off
          [data-sidebar="collapsed"], so the inline script in the layout
          can drive layout before React hydrates. */}
      <div
        className="tahi-sidebar-brand flex items-center flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border-subtle)',
          height: '3.5rem',
        }}
      >
        <Link
          href="/overview"
          aria-label="Tahi Studio. Go to overview"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          {/* One brand mark at a time. CSS-driven visibility: the icon
              mark shows only when [data-sidebar="collapsed"] is set,
              the wordmark only when it isn't. Both render in the DOM
              so the swap can't flash on refresh. */}
          <span
            className="tahi-sidebar-collapsed-only"
            style={{ alignItems: 'center' }}
          >
            <TahiIconMark size={34} variant="on-light" />
          </span>
          <span
            className="tahi-sidebar-expanded-only"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--color-text-active)',
            }}
          >
            <TahiStudioWordmark height={26} title="Tahi Studio" />
          </span>
        </Link>
      </div>

      {/* Nav region */}
      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto"
        style={{ padding: '1.25rem 0.5rem 0.75rem' }}
      >
        {visibleNav.map((group) => {
          const open = isGroupOpen(group)
          const groupId = 'nav-group-' + group.group.toLowerCase().replace(/\s+/g, '-')
          return (
            // Group spacing + collapsed-mode divider come from CSS
            // (.tahi-sidebar-nav-group + first-child) so the layout is
            // correct before React hydrates.
            <div key={group.group} className="tahi-sidebar-nav-group">
              {!collapsed && (
                group.collapsible ? (
                  <button
                    onClick={() => toggleGroup(group.group)}
                    aria-expanded={open}
                    aria-controls={groupId}
                    className="tahi-sidebar-expanded-only"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '0.125rem 0.5rem 0.375rem',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-subtle)',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span>{group.group}</span>
                    <ChevronDown
                      className="w-3 h-3"
                      style={{
                        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform var(--motion-base, 320ms) var(--ease-out)',
                      }}
                    />
                  </button>
                ) : (
                  <p
                    className="tahi-sidebar-expanded-only"
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-subtle)',
                      padding: '0.125rem 0.5rem 0.375rem',
                      margin: 0,
                    }}
                  >
                    {group.group}
                  </p>
                )
              )}
              <ul
                id={groupId}
                className="tahi-nav-group-items"
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'grid',
                  gridTemplateRows: open ? '1fr' : '0fr',
                  overflow: 'hidden',
                }}
                aria-hidden={!open}
              >
                <div style={{ minHeight: 0 }}>
                  {group.items.map(item => {
                    const Icon = item.icon
                    const active = isItemActive(item.href)
                    // Padding + justify-content + nested left-indent come
                    // from CSS (.tahi-nav-link[.tahi-nav-link-nested]) so
                    // the layout is correct before React hydrates.
                    const link = (
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        data-tour={`nav-${item.label.toLowerCase()}`}
                        className={cn(
                          'tahi-nav-link',
                          group.collapsible && 'tahi-nav-link-nested',
                        )}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.625rem',
                          // Active state is the rare leaf-radius moment in
                          // the sidebar. Brand-100 tint, leaf-sm corner,
                          // brand text. Reads as "this is where you are
                          // right now" without being a loud surface.
                          borderRadius: active ? 'var(--radius-leaf-sm)' : 'var(--radius-md)',
                          fontSize: '0.8125rem',
                          fontWeight: active ? 600 : 500,
                          color: active ? 'var(--color-text-active)' : 'var(--color-text-muted)',
                          background: active ? 'var(--color-brand-100)' : 'transparent',
                          textDecoration: 'none',
                          minHeight: '40px',
                          transition: 'background var(--motion-quick, 220ms) var(--ease-out), color var(--motion-quick, 220ms) var(--ease-out)',
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            e.currentTarget.style.background = 'var(--color-hover-tint)'
                            e.currentTarget.style.color = 'var(--color-text)'
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'var(--color-text-muted)'
                          }
                        }}
                      >
                        <span
                          className="tahi-nav-icon"
                          style={{
                            display: 'flex',
                            flexShrink: 0,
                            color: active ? 'var(--color-brand)' : 'var(--color-text-muted)',
                            transition: 'color var(--motion-quick, 220ms) var(--ease-out)',
                          }}
                        >
                          {/* Icon size is CSS-driven via
                              .tahi-nav-icon svg + [data-sidebar="collapsed"]
                              so it can't lag behind React state. */}
                          <Icon />
                        </span>
                        {!collapsed && (
                          <span
                            className="tahi-sidebar-expanded-only"
                            style={{
                              flex: 1,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.label}
                          </span>
                        )}
                        {!collapsed && item.count != null && (
                          <span
                            className="tahi-sidebar-expanded-only"
                            style={{
                              background: active ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
                              color: active ? '#ffffff' : 'var(--color-text-muted)',
                              border: active ? 'none' : '1px solid var(--color-border-subtle)',
                              fontSize: '0.625rem',
                              fontWeight: 600,
                              padding: '0.0625rem 0.4375rem',
                              borderRadius: '9999px',
                              minWidth: '1.25rem',
                              textAlign: 'center',
                            }}
                          >
                            {item.count}
                          </span>
                        )}
                      </Link>
                    )
                    return (
                      <li key={item.href} style={{ marginBottom: '0.125rem' }}>
                        {collapsed
                          ? <Tooltip label={item.label} side="top">{link}</Tooltip>
                          : link}
                      </li>
                    )
                  })}
                </div>
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Footer: collapse toggle + user card. Theme toggle now lives
          inside the user card menu so the footer stays tight. */}
      <div
        style={{
          padding: '0.5rem',
          borderTop: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <FooterButton
          onClick={() => setCollapsed(!collapsed)}
          collapsed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          tooltip={collapsed ? 'Expand' : 'Collapse'}
        >
          <span style={{ display: 'flex', flexShrink: 0, color: 'var(--color-text-muted)' }}>
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </span>
          {!collapsed && <span className="tahi-sidebar-expanded-only">Collapse</span>}
        </FooterButton>
        <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.375rem 0' }} />
        <SidebarUserCard
          collapsed={collapsed}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      </div>
    </>
  )
}

interface FooterButtonProps {
  onClick: () => void
  collapsed: boolean
  children: React.ReactNode
  'aria-label': string
  tooltip: string
}

function FooterButton({ onClick, collapsed, children, tooltip, ...rest }: FooterButtonProps) {
  const button = (
    <button
      {...rest}
      onClick={onClick}
      className="tahi-sidebar-footer-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        // padding + justifyContent come from CSS so they don't lag
        // React state on the first paint after refresh.
        borderRadius: 'var(--radius-md)',
        fontSize: '0.8125rem',
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        width: '100%',
        marginBottom: '0.125rem',
        minHeight: '40px',
        transition: 'background var(--motion-quick, 220ms) var(--ease-out), color var(--motion-quick, 220ms) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-hover-tint)'
        e.currentTarget.style.color = 'var(--color-text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      {children}
    </button>
  )
  return collapsed ? <Tooltip label={tooltip} side="top">{button}</Tooltip> : button
}
