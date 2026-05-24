'use client'

/**
 * <MobileBottomNav>. Fixed bottom tab bar on mobile.
 *
 *   Tabs (admin):  Overview | Requests | Tasks | Messages | More
 *   Tabs (client): Overview | Requests | Messages | Files    | More
 *
 *   "More" opens a bottom-sheet drawer with the full nav, styled to
 *   match the desktop sidebar (cream surface, sidebar-style active
 *   state, brand-deepest text, leaf-radius selection). No collapsing
 *   on mobile, just flat group headers + items. User profile card
 *   pinned to the bottom of the drawer.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Inbox, MessageSquare, FileText, Users, FolderOpen,
  Menu, X, CheckSquare, TrendingUp, Star, CreditCard, Clock, BarChart2,
  Gauge, UserCog, FileSignature, BookOpen, ShoppingBag, Calendar,
  Megaphone, UserPlus,
} from 'lucide-react'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { SidebarUserCard } from '@/components/tahi/sidebar-user-card'
import { FocusTrap } from '@/components/tahi/focus-trap'

const ADMIN_BOTTOM = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Tasks',    href: '/tasks',    icon: CheckSquare },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
] as const

const CLIENT_BOTTOM = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Files',    href: '/files',    icon: FolderOpen },
] as const

interface DrawerNavItem {
  label: string
  href: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' }>
}
interface DrawerNavGroup {
  group: string
  items: DrawerNavItem[]
}

const ADMIN_DRAWER: DrawerNavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', href: '/overview', icon: LayoutDashboard },
      { label: 'Requests', href: '/requests', icon: Inbox },
      { label: 'Tasks',    href: '/tasks',    icon: CheckSquare },
      { label: 'Messages', href: '/messages', icon: MessageSquare },
    ],
  },
  {
    group: 'Sales',
    items: [
      { label: 'Leads',           href: '/leads',           icon: UserPlus },
      { label: 'Deals',           href: '/deals',           icon: TrendingUp },
      { label: 'Proposals',       href: '/proposals',       icon: FileText },
      { label: 'Schedules',       href: '/schedules',       icon: Calendar },
      { label: 'Contracts',       href: '/contracts',       icon: FileSignature },
      { label: 'Sales analytics', href: '/sales-analytics', icon: BarChart2 },
    ],
  },
  {
    group: 'Clients',
    items: [{ label: 'Clients', href: '/clients', icon: Users }],
  },
  {
    group: 'Marketing',
    items: [
      { label: 'Reviews',       href: '/reviews',       icon: Star },
      { label: 'Announcements', href: '/announcements', icon: Megaphone },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText },
      { label: 'Billing',  href: '/billing',  icon: CreditCard },
      { label: 'Time',     href: '/time',     icon: Clock },
      { label: 'Reports',  href: '/reports',  icon: BarChart2 },
    ],
  },
  {
    group: 'Operations',
    items: [
      { label: 'Capacity', href: '/capacity', icon: Gauge },
      { label: 'Team',     href: '/team',     icon: UserCog },
    ],
  },
  {
    group: 'Knowledge',
    items: [{ label: 'Docs Hub', href: '/docs', icon: BookOpen }],
  },
  // Settings intentionally absent here — it lives in the user card popup
  // pinned to the bottom of the drawer to avoid two links to the same place.
]

const CLIENT_DRAWER: DrawerNavGroup[] = [
  {
    group: 'Your project',
    items: [
      { label: 'Overview', href: '/overview', icon: LayoutDashboard },
      { label: 'Requests', href: '/requests', icon: Inbox },
      { label: 'Messages', href: '/messages', icon: MessageSquare },
    ],
  },
  {
    group: 'Library',
    items: [
      { label: 'Files',    href: '/files',    icon: FolderOpen },
      { label: 'Services', href: '/services', icon: ShoppingBag },
    ],
  },
  {
    group: 'Billing',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText },
      { label: 'Billing',  href: '/billing',  icon: CreditCard },
    ],
  },
]

interface MobileBottomNavProps {
  isAdmin?: boolean
}

export function MobileBottomNav({ isAdmin = false }: MobileBottomNavProps) {
  const pathname = usePathname()
  const { isImpersonatingClient } = useImpersonation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Local theme state for the user card's theme toggle. Mirrors the
  // sidebar's logic so toggling from either surface stays in sync.
  const [darkMode, setDarkMode] = useState(false)
  useEffect(() => {
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

  const showAsAdmin = isAdmin && !isImpersonatingClient
  const bottomItems = showAsAdmin ? ADMIN_BOTTOM : CLIENT_BOTTOM
  const drawerGroups = showAsAdmin ? ADMIN_DRAWER : CLIENT_DRAWER

  // Close drawer on route change.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Lock scroll while drawer is open.
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [drawerOpen])

  // Active route detection mirrors the desktop sidebar's logic so
  // both surfaces highlight the same items.
  const exactOnly = new Set(['/requests', '/overview', '/proposals'])
  const isItemActive = (href: string) =>
    pathname === href || (!exactOnly.has(href) && pathname.startsWith(href))

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex items-stretch justify-around"
        aria-label="Primary"
        style={{
          height: '3.75rem',
          background: 'var(--color-bg-cream)',
          borderTop: '1px solid var(--color-border-subtle)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          zIndex: 50,
        }}
      >
        {bottomItems.map(item => {
          const Icon = item.icon
          const active = isItemActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="flex flex-col items-center justify-center flex-1 gap-0.5"
              style={{
                textDecoration: 'none',
                color: active ? 'var(--color-text-active)' : 'var(--color-text-muted)',
                minHeight: '2.75rem',
                fontWeight: active ? 600 : 500,
                transition: 'color var(--motion-quick, 220ms) var(--ease-out, ease-out)',
              }}
            >
              <Icon
                size={20}
                aria-hidden="true"
                className="flex-shrink-0"
                style={{ color: active ? 'var(--color-brand)' : 'var(--color-text-muted)' }}
              />
              <span style={{
                fontSize: '0.625rem',
                lineHeight: 1,
              }}>
                {item.label}
              </span>
            </Link>
          )
        })}

        {/* More button. Opens the bottom-sheet drawer with the full nav. */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center justify-center flex-1 gap-0.5"
          aria-label="Open full navigation menu"
          aria-expanded={drawerOpen}
          style={{
            background: 'transparent',
            border: 'none',
            color: drawerOpen ? 'var(--color-text-active)' : 'var(--color-text-muted)',
            minHeight: '2.75rem',
            fontWeight: drawerOpen ? 600 : 500,
            transition: 'color var(--motion-quick, 220ms) var(--ease-out, ease-out)',
          }}
        >
          <Menu
            size={20}
            aria-hidden="true"
            className="flex-shrink-0"
            style={{ color: drawerOpen ? 'var(--color-brand)' : 'var(--color-text-muted)' }}
          />
          <span style={{ fontSize: '0.625rem', lineHeight: 1 }}>More</span>
        </button>
      </nav>

      {/* Bottom-sheet drawer. Matches the sidebar's cream surface,
          sidebar-style active state. Flat groups, no collapsing
          (mobile users want everything visible). User card pinned
          to the bottom. */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false)
          }}
          style={{
            background: 'rgba(18, 26, 15, 0.5)',
            zIndex: 60,
          }}
        >
          <FocusTrap
            active={drawerOpen}
            onEscape={() => setDrawerOpen(false)}
            className="absolute bottom-0 left-0 right-0 flex flex-col"
            style={{
              background: 'var(--color-bg-cream)',
              borderTopLeftRadius: 'var(--radius-xl)',
              borderTopRightRadius: 'var(--radius-xl)',
              maxHeight: '90vh',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              animation: 'slideUp 320ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Drawer header: grab handle + title + close */}
            <div className="flex-shrink-0" style={{ padding: '0.75rem 0 0' }}>
              <div
                aria-hidden="true"
                style={{
                  width: '2.5rem',
                  height: '0.25rem',
                  background: 'var(--color-border-strong)',
                  borderRadius: '9999px',
                  margin: '0 auto',
                }}
              />
            </div>
            <div
              className="flex items-center justify-between flex-shrink-0"
              style={{
                padding: '0.75rem 1.25rem 0.5rem',
              }}
            >
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                Menu
              </h2>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex items-center justify-center"
                style={{
                  width: '2.25rem',
                  height: '2.25rem',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background var(--motion-quick, 220ms) var(--ease-out, ease-out)',
                }}
                onTouchStart={e => { e.currentTarget.style.background = 'var(--color-hover-tint)' }}
                onTouchEnd={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {/* Nav groups */}
            <div
              className="overflow-y-auto flex-1"
              style={{
                padding: '0.25rem 0.75rem 1rem',
              }}
            >
              {drawerGroups.map((group) => (
                <div key={group.group} style={{ marginTop: '0.75rem' }}>
                  <p style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: 'var(--color-text-subtle)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '0 0.625rem 0.375rem',
                    margin: 0,
                  }}>
                    {group.group}
                  </p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {group.items.map(item => {
                      const Icon = item.icon
                      const active = isItemActive(item.href)
                      return (
                        <li key={item.href} style={{ marginBottom: '0.125rem' }}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.75rem',
                              padding: '0.6875rem 0.625rem',
                              borderRadius: 'var(--radius-md)',
                              fontSize: '0.9375rem',
                              fontWeight: active ? 600 : 500,
                              color: active ? 'var(--color-text-active)' : 'var(--color-text-muted)',
                              background: active ? 'var(--color-bg)' : 'transparent',
                              boxShadow: active ? 'inset 0 0 0 1px var(--color-border-subtle)' : 'none',
                              textDecoration: 'none',
                              minHeight: '2.75rem',
                              transition: 'background var(--motion-quick, 220ms) var(--ease-out, ease-out), color var(--motion-quick, 220ms) var(--ease-out, ease-out)',
                            }}
                          >
                            <Icon
                              size={18}
                              aria-hidden="true"
                              className="flex-shrink-0"
                              style={{ color: active ? 'var(--color-brand)' : 'var(--color-text-muted)' }}
                            />
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>

            {/* User card pinned to the bottom of the drawer */}
            <div
              style={{
                flexShrink: 0,
                padding: '0.5rem 0.75rem',
                borderTop: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-cream)',
              }}
            >
              <SidebarUserCard
                collapsed={false}
                darkMode={darkMode}
                onToggleDarkMode={toggleDarkMode}
              />
            </div>
          </FocusTrap>
        </div>
      )}
    </>
  )
}
