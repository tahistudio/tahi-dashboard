'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Inbox, MessageSquare, FileText, Users, FolderOpen } from 'lucide-react'

const ADMIN_NAV = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Clients', href: '/clients', icon: Users },
] as const

const CLIENT_NAV = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Files', href: '/files', icon: FolderOpen },
  { label: 'Invoices', href: '/invoices', icon: FileText },
] as const

interface MobileBottomNavProps {
  isAdmin?: boolean
}

export function MobileBottomNav({ isAdmin = false }: MobileBottomNavProps) {
  const pathname = usePathname()
  const items = isAdmin ? ADMIN_NAV : CLIENT_NAV

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around"
      style={{
        height: '3.5rem',
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {items.map(item => {
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
              style={{ flexShrink: 0 }}
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
    </nav>
  )
}
