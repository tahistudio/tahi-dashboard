'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Inbox, MessageSquare, FileText } from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'Requests', href: '/requests', icon: Inbox },
  { label: 'Messages', href: '/messages', icon: MessageSquare },
  { label: 'Invoices', href: '/invoices', icon: FileText },
] as const

export function MobileBottomNav() {
  const pathname = usePathname()

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
      {NAV_ITEMS.map(item => {
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
              size={20}
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
