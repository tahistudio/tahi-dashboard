'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Inbox,
  CreditCard,
  FileText,
  Clock,
  CheckSquare,
  BarChart2,
  BookOpen,
  UserCog,
  Settings,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TahiWordmark, LeafLogo } from './leaf-logo'
import { useState } from 'react'

const navItems = [
  {
    group: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    group: 'Work',
    items: [
      { label: 'Clients', href: '/admin/clients', icon: Users },
      { label: 'Requests', href: '/admin/requests', icon: Inbox },
      { label: 'Tasks', href: '/admin/tasks', icon: CheckSquare },
      { label: 'Time', href: '/admin/time', icon: Clock },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Billing', href: '/admin/billing', icon: CreditCard },
      { label: 'Invoices', href: '/admin/invoices', icon: FileText },
    ],
  },
  {
    group: 'Insights',
    items: [
      { label: 'Reports', href: '/admin/reports', icon: BarChart2 },
    ],
  },
  {
    group: 'Studio',
    items: [
      { label: 'Docs Hub', href: '/admin/docs', icon: BookOpen },
      { label: 'Team', href: '/admin/team', icon: UserCog },
      { label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] transition-all duration-200 relative',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-[var(--color-border)] flex-shrink-0">
        {collapsed ? (
          <LeafLogo size="sm" />
        ) : (
          <TahiWordmark size="sm" />
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center hover:bg-[var(--color-bg-secondary)] transition-colors z-10 shadow-sm"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          className={cn(
            'w-3 h-3 text-[var(--color-text-muted)] transition-transform',
            collapsed && 'rotate-180'
          )}
        />
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navItems.map((group) => (
          <div key={group.group}>
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] px-2 mb-1">
                {group.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/admin/dashboard' && pathname.startsWith(item.href))

                return (
                  <li key={item.href}>
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

      {/* Bottom: Plan badge / user info area */}
      {!collapsed && (
        <div className="p-3 border-t border-[var(--color-border)]">
          <div
            className="px-3 py-2 text-xs text-[var(--color-text-muted)]"
            style={{ borderRadius: 'var(--radius-leaf-sm)', background: 'var(--color-brand-50)' }}
          >
            <p className="font-semibold text-[var(--color-brand-dark)]">Tahi Studio</p>
            <p className="text-[var(--color-text-subtle)]">Admin workspace</p>
          </div>
        </div>
      )}
    </aside>
  )
}
