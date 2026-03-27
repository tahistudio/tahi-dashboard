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
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TahiWordmark, LeafLogo } from './leaf-logo'
import { useState } from 'react'

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
      { label: 'Billing',   href: '/billing',   icon: CreditCard, adminOnly: true },
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
      { label: 'Reports',   href: '/reports',   icon: BarChart2,  adminOnly: true },
      { label: 'Time',      href: '/time',      icon: Clock,      adminOnly: true },
    ],
  },
  {
    group: 'Studio',
    items: [
      { label: 'Team',      href: '/team',      icon: UserCog,    adminOnly: true },
      { label: 'Docs Hub',  href: '/docs',      icon: BookOpen,   adminOnly: true },
      { label: 'Settings',  href: '/settings',  icon: Settings },
    ],
  },
]

// Sidebar uses a locked dark-green color scheme regardless of page theme.
// All colors are literal hex so CSS hover: classes work reliably.
const S = {
  bg:          '#1e2a1b',   // sidebar background — slightly deeper than page dark
  border:      '#2e3d2b',   // subtle divider
  groupLabel:  '#4a6145',   // faint group headings
  textMuted:   '#7aaa72',   // inactive nav text
  textActive:  '#ffffff',   // active nav text
  bgHover:     '#2a3826',   // nav item hover bg
  bgActive:    '#2f3f2c',   // nav item active bg
  iconMuted:   '#5f9458',   // inactive icon
  iconActive:  '#93c98a',   // active icon
}

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const visibleNav = NAV.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (item.adminOnly && !isAdmin) return false
      if (item.clientOnly && isAdmin) return false
      return true
    }),
  })).filter(group => group.items.length > 0)

  return (
    <aside
      className={cn(
        'flex flex-col h-full transition-all duration-200 relative flex-shrink-0',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}
      style={{ background: S.bg, borderRight: `1px solid ${S.border}` }}
    >
      {/* Logo area */}
      <div
        className="flex items-center h-14 px-4 flex-shrink-0"
        style={{ borderBottom: `1px solid ${S.border}` }}
      >
        {collapsed
          ? <LeafLogo size="sm" />
          : <TahiWordmark size="sm" light />
        }
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {visibleNav.map((group, gi) => (
          <div key={group.group} className={gi > 0 ? 'mt-4' : ''}>
            {!collapsed && (
              <p
                className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1"
                style={{ color: S.groupLabel }}
              >
                {group.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/requests' && item.href !== '/overview' && pathname.startsWith(item.href))

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150',
                        collapsed && 'justify-center px-0',
                        isActive
                          ? 'text-white'
                          : 'hover:text-white'
                      )}
                      style={{
                        color: isActive ? S.textActive : S.textMuted,
                        background: isActive ? S.bgActive : undefined,
                      }}
                      // pure CSS hover via onMouse is replaced by Tailwind-compatible approach below
                    >
                      <span
                        className="flex-shrink-0 flex items-center"
                        style={{ color: isActive ? S.iconActive : S.iconMuted }}
                      >
                        <Icon className={cn(collapsed ? 'w-[18px] h-[18px]' : 'w-[15px] h-[15px]')} />
                      </span>
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle at bottom */}
      <div
        className="p-2 flex-shrink-0"
        style={{ borderTop: `1px solid ${S.border}` }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] transition-colors',
            collapsed && 'justify-center px-0'
          )}
          style={{ color: S.textMuted }}
          onMouseEnter={e => { e.currentTarget.style.color = S.textActive; e.currentTarget.style.background = S.bgHover }}
          onMouseLeave={e => { e.currentTarget.style.color = S.textMuted; e.currentTarget.style.background = 'transparent' }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <span style={{ color: S.iconMuted, display: 'flex' }}><PanelLeftOpen className="w-[15px] h-[15px]" /></span>
            : <>
                <span style={{ color: S.iconMuted, display: 'flex' }}><PanelLeftClose className="w-[15px] h-[15px]" /></span>
                <span>Collapse</span>
              </>
          }
        </button>
      </div>
    </aside>
  )
}
