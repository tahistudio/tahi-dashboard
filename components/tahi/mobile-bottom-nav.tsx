'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Inbox, MessageSquare, FileText, Users, FolderOpen,
  Menu, X, CheckSquare, TrendingUp, Star, CreditCard, Clock, BarChart2,
  Gauge, UserCog, FileSignature, BookOpen, Settings, ShoppingBag,
} from 'lucide-react'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

// Bottom bar: 4 most-used + More button
const ADMIN_BOTTOM = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Clients', href: '/clients', icon: Users },
] as const

const CLIENT_BOTTOM = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Files', href: '/files', icon: FolderOpen },
] as const

// More drawer: grouped full nav
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
      { label: 'Tasks', href: '/tasks', icon: CheckSquare },
      { label: 'Messages', href: '/messages', icon: MessageSquare },
    ],
  },
  {
    group: 'Clients',
    items: [
      { label: 'Clients', href: '/clients', icon: Users },
      { label: 'Pipeline', href: '/pipeline', icon: TrendingUp },
      { label: 'Reviews', href: '/reviews', icon: Star },
    ],
  },
  {
    group: 'Billing',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText },
      { label: 'Billing', href: '/billing', icon: CreditCard },
      { label: 'Time', href: '/time', icon: Clock },
    ],
  },
  {
    group: 'Operations',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart2 },
      { label: 'Capacity', href: '/capacity', icon: Gauge },
      { label: 'Team', href: '/team', icon: UserCog },
      { label: 'Contracts', href: '/contracts', icon: FileSignature },
    ],
  },
  {
    group: 'Account',
    items: [
      { label: 'Docs Hub', href: '/docs', icon: BookOpen },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
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
      { label: 'Files', href: '/files', icon: FolderOpen },
      { label: 'Services', href: '/services', icon: ShoppingBag },
    ],
  },
  {
    group: 'Billing',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText },
      { label: 'Billing', href: '/billing', icon: CreditCard },
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

  const showAsAdmin = isAdmin && !isImpersonatingClient
  const bottomItems = showAsAdmin ? ADMIN_BOTTOM : CLIENT_BOTTOM
  const drawerGroups = showAsAdmin ? ADMIN_DRAWER : CLIENT_DRAWER

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Lock scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around"
        style={{
          height: '3.5rem',
          background: 'var(--color-bg)',
          borderTop: '1px solid var(--color-border)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {bottomItems.map(item => {
          const Icon = item.icon
          const isActive =
            pathname === item.href ||
            (item.href !== '/overview' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors"
              style={{
                textDecoration: 'none',
                color: isActive ? 'var(--color-brand)' : 'var(--color-text-muted)',
                minHeight: '2.75rem',
              }}
            >
              <Icon
                size={isActive ? 22 : 20}
                aria-hidden="true"
                className="flex-shrink-0"
              />
              <span
                style={{
                  fontSize: '0.625rem',
                  fontWeight: isActive ? 600 : 500,
                  lineHeight: 1,
                }}
              >
                {item.label}
              </span>
            </Link>
          )
        })}

        {/* More button - opens drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors"
          style={{
            background: 'transparent',
            border: 'none',
            color: drawerOpen ? 'var(--color-brand)' : 'var(--color-text-muted)',
            minHeight: '2.75rem',
          }}
          aria-label="Open full navigation menu"
        >
          <Menu size={20} aria-hidden="true" className="flex-shrink-0" />
          <span style={{ fontSize: '0.625rem', fontWeight: 500, lineHeight: 1 }}>
            More
          </span>
        </button>
      </nav>

      {/* Full nav drawer */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60]"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false)
          }}
          style={{ background: 'rgba(0,0,0,0.4)' }}
        >
          <div
            className="absolute bottom-0 left-0 right-0 flex flex-col"
            style={{
              background: 'var(--color-bg)',
              borderTopLeftRadius: 'var(--radius-lg)',
              borderTopRightRadius: 'var(--radius-lg)',
              maxHeight: '85vh',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              animation: 'slideUp 200ms ease-out',
            }}
          >
            {/* Drawer header */}
            <div
              className="flex items-center justify-between flex-shrink-0"
              style={{
                padding: 'var(--space-4) var(--space-5)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
                Menu
              </h2>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-center"
                style={{
                  width: '2rem',
                  height: '2rem',
                  background: 'var(--color-bg-tertiary)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                }}
                aria-label="Close menu"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Drawer nav groups */}
            <div className="overflow-y-auto flex-1" style={{ padding: 'var(--space-4) var(--space-5) var(--space-6)' }}>
              {drawerGroups.map((group) => (
                <div key={group.group} style={{ marginBottom: 'var(--space-5)' }}>
                  <p style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--color-text-subtle)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    marginBottom: 'var(--space-2)',
                    paddingLeft: 'var(--space-2)',
                  }}>
                    {group.group}
                  </p>
                  <div className="flex flex-col" style={{ gap: 'var(--space-0-5)' }}>
                    {group.items.map(item => {
                      const Icon = item.icon
                      const isActive = pathname === item.href ||
                        (item.href !== '/overview' && pathname.startsWith(item.href))
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex items-center"
                          style={{
                            padding: 'var(--space-3)',
                            gap: 'var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            textDecoration: 'none',
                            background: isActive ? 'var(--color-brand-50)' : 'transparent',
                            color: isActive ? 'var(--color-brand-dark)' : 'var(--color-text)',
                            fontWeight: isActive ? 600 : 500,
                            fontSize: 'var(--text-base)',
                            minHeight: '2.75rem',
                          }}
                        >
                          <Icon
                            size={18}
                            aria-hidden="true"
                            className="flex-shrink-0"
                            style={{ color: isActive ? 'var(--color-brand)' : 'var(--color-text-muted)' }}
                          />
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
