'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Inbox,
  Users,
  CreditCard,
  FileText,
  Clock,
  CheckSquare,
  BarChart2,
  BookOpen,
  UserCog,
  Settings,
  MessageSquare,
  FolderOpen,
  ShoppingBag,
  ChevronLeft,
  LayoutDashboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TahiWordmark, LeafLogo } from './leaf-logo'
import { useState } from 'react'

// ─── Nav configs ────────────────────────────────────────────

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  clientOnly?: boolean
}

type NavGroup = {
  group: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    group: 'Work',
    items: [
      { label: 'Overview',  href: '/overview',  icon: LayoutDashboard },
      { label: 'Requests',  href: '/requests',  icon: Inbox },
      { label: 'Tasks',     href: '/tasks',     icon: CheckSquare },
      { label: 'Messages',  href: '/messages',  icon: MessageSquare },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Invoices',  href: '/invoices',  icon: FileText },
      { label: 'Billing',   href: '/billing',   icon: CreditCard,  adminOnly: true },
    ],
  },
  {
    group: 'Clients',
    items: [
      { label: 'Clients',   href: '/clients',   icon: Users,       adminOnly: true },
      { label: 'Files',     href: '/files',     icon: FolderOpen,  clientOnly: true },
      { label: 'Services',  href: '/services',  icon: ShoppingBag, clientOnly: true },
    ],
  },
  {
    group: 'Insights',
    items: [
      { label: 'Reports',   href: '/reports',   icon: BarChart2,   adminOnly: true },
      { label: 'Time',      href: '/time',      icon: Clock,       adminOnly: true },
    ],
  },
  {
    group: 'Studio',
    items: [
      { label: 'Team',      href: '/team',      icon: UserCog,     adminOnly: true },
      { label: 'Docs Hub',  href: '/docs',      icon: BookOpen,    adminOnly: true },
      { label: 'Settings',  href: '/settings',  icon: Settings },
    ],
  },
]

// ─── Component ──────────────────────────────────────────────

interface AppSidebarProps {
  isAdmin: boolean
}

export function AppSidebar({ isAdmin }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Filter nav items based on role
  const visibleNav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.adminOnly && !isAdmin) return false
      if (item.clientOnly && isAdmin) return false
      return true
    }),
  })).filter((group) => group.items.length > 0)

  return (
    <aside
      className={cn(
        'flex flex-col h-full transition-all duration-200 relative flex-shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{ background: 'var(--color-bg-dark)', borderRight: '1px solid var(--color-border-dark)' }}
    >
      {/* Logo */}
      <div
        className="flex items-center h-16 px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-dark)' }}
      >
        {collapsed
          ? <LeafLogo size="sm" />
          : <TahiWordmark size="sm" light />
        }
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full flex items-center justify-center z-10 shadow-md transition-colors hover:opacity-90"
        style={{
          background: 'var(--color-bg-dark)',
          border: '1px solid var(--color-border-dark)',
        }}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          className={cn(
            'w-3 h-3 transition-transform duration-200',
            collapsed && 'rotate-180'
          )}
          style={{ color: 'var(--color-text-dark-muted)' }}
        />
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {visibleNav.map((group) => (
          <div key={group.group}>
            {!collapsed && (
              <p
                className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1.5"
                style={{ color: 'rgba(168, 196, 160, 0.5)' }}
              >
                {group.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/requests' && item.href !== '/overview' && pathname.startsWith(item.href))

                return (
                  <li key={item.href + item.label}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors group',
                        collapsed && 'justify-center'
                      )}
                      style={
                        isActive
                          ? {
                              background: 'var(--color-bg-dark-tertiary)',
                              color: 'white',
                            }
                          : {
                              color: 'var(--color-text-dark-muted)',
                            }
                      }
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'var(--color-bg-dark-tertiary)'
                          e.currentTarget.style.color = 'white'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--color-text-dark-muted)'
                        }
                      }}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon
                        className={cn(
                          'flex-shrink-0',
                          collapsed ? 'w-5 h-5' : 'w-4 h-4',
                          isActive ? 'text-[var(--color-brand-light)]' : 'text-[var(--color-text-dark-muted)]'
                        )}
                      />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom identity badge */}
      {!collapsed && (
        <div
          className="p-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border-dark)' }}
        >
          <div
            className="px-3 py-2 text-xs rounded-lg"
            style={{
              background: 'rgba(90, 130, 78, 0.15)',
              border: '1px solid rgba(90, 130, 78, 0.25)',
            }}
          >
            <p className="font-semibold" style={{ color: 'var(--color-brand-light)' }}>
              {isAdmin ? 'Tahi Studio' : 'Client Portal'}
            </p>
            <p className="mt-0.5" style={{ color: 'rgba(168, 196, 160, 0.6)' }}>
              {isAdmin ? 'Admin workspace' : 'Powered by Tahi Studio'}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
