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
      { label: 'Overview',  href: '/requests',  icon: LayoutDashboard },
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
        'flex flex-col h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] transition-all duration-200 relative flex-shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-[var(--color-border)] flex-shrink-0">
        {collapsed ? <LeafLogo size="sm" /> : <TahiWordmark size="sm" />}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center hover:bg-[var(--color-bg-secondary)] transition-colors z-10 shadow-sm"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          className={cn(
            'w-3 h-3 text-[var(--color-text-muted)] transition-transform duration-200',
            collapsed && 'rotate-180'
          )}
        />
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {visibleNav.map((group) => (
          <div key={group.group}>
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] px-2 mb-1.5">
                {group.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/requests' && pathname.startsWith(item.href))

                return (
                  <li key={item.href + item.label}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors group',
                        isActive
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-dark)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]',
                        collapsed && 'justify-center'
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon
                        className={cn(
                          'flex-shrink-0 transition-colors',
                          collapsed ? 'w-5 h-5' : 'w-4 h-4',
                          isActive
                            ? 'text-[var(--color-brand)]'
                            : 'text-[var(--color-text-subtle)] group-hover:text-[var(--color-text-muted)]'
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
        <div className="p-3 border-t border-[var(--color-border)] flex-shrink-0">
          <div
            className="px-3 py-2 text-xs"
            style={{
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand-50)',
              border: '1px solid var(--color-brand-200)',
            }}
          >
            <p className="font-semibold text-[var(--color-brand-dark)]">
              {isAdmin ? 'Tahi Studio' : 'Client Portal'}
            </p>
            <p className="text-[var(--color-text-subtle)] mt-0.5">
              {isAdmin ? 'Admin workspace' : 'Powered by Tahi Studio'}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
