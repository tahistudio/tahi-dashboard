'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  FolderOpen,
  FileText,
  MessageSquare,
  CheckSquare,
  Settings,
  ShoppingBag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TahiWordmark } from './leaf-logo'

const navItems = [
  { label: 'Overview', href: '/portal/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/portal/requests', icon: Inbox },
  { label: 'Tasks', href: '/portal/tasks', icon: CheckSquare },
  { label: 'Files', href: '/portal/files', icon: FolderOpen },
  { label: 'Invoices', href: '/portal/invoices', icon: FileText },
  { label: 'Messages', href: '/portal/messages', icon: MessageSquare },
  { label: 'Services', href: '/portal/services', icon: ShoppingBag },
  { label: 'Settings', href: '/portal/settings', icon: Settings },
]

export function PortalSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex flex-col w-56 h-full bg-[var(--color-bg)] border-r border-[var(--color-border)] flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-[var(--color-border)]">
        <TahiWordmark size="sm" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive =
              pathname === item.href ||
              (item.href !== '/portal/overview' && pathname.startsWith(item.href))

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-dark)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]'
                  )}
                >
                  <Icon
                    className={cn(
                      'w-4 h-4 flex-shrink-0',
                      isActive
                        ? 'text-[var(--color-brand)]'
                        : 'text-[var(--color-text-subtle)]'
                    )}
                  />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Bottom: Plan info */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div
          className="px-3 py-2.5 text-xs"
          style={{ borderRadius: 'var(--radius-leaf-sm)', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <p className="font-semibold text-[var(--color-text)]">Client Portal</p>
          <p className="text-[var(--color-text-muted)] mt-0.5">Powered by Tahi Studio</p>
        </div>
      </div>
    </aside>
  )
}
