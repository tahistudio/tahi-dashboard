'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Inbox, Users, CreditCard, FileText, Clock, CheckSquare,
  BarChart2, BookOpen, UserCog, Settings, MessageSquare,
  FolderOpen, ShoppingBag, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Moon, Sun, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TahiWordmark, LeafLogo } from './leaf-logo'
import { useState, useEffect } from 'react'

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
      { label: 'Reviews',   href: '/reviews',   icon: Star,       adminOnly: true },
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

// All sidebar colors as hex constants; never rely on Tailwind CSS variables here
const S = {
  bg:         '#1e2a1b',
  border:     '#2d3d2a',
  groupLabel: '#4a6145',
  textMuted:  '#7aaa72',
  textActive: '#ffffff',
  bgHover:    '#2a3826',
  bgActive:   '#2f3f2c',
  iconMuted:  '#5f9458',
  iconActive: '#93c98a',
}

const EXPANDED_WIDTH  = 224  // px
const COLLAPSED_WIDTH = 64   // px

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  // Read sidebar + dark mode preferences from localStorage on mount
  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem('tahi-theme')
      setDarkMode(storedTheme === 'dark')

      const storedSidebar = localStorage.getItem('tahi-sidebar')
      if (storedSidebar === 'collapsed') setCollapsed(true)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    try {
      if (next) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('tahi-theme', 'dark')
      } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('tahi-theme', 'light')
      }
    } catch {
      // localStorage unavailable
    }
  }

  const visibleNav = NAV.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (item.adminOnly && !isAdmin) return false
      if (item.clientOnly && isAdmin) return false
      return true
    }),
  })).filter(group => group.items.length > 0)

  const w = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH

  return (
    <aside
      className="flex flex-col h-full flex-shrink-0 transition-all duration-200 relative"
      style={{
        width: `${w}px`,
        minWidth: `${w}px`,
        background: S.bg,
        borderRight: `1px solid ${S.border}`,
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center h-14 flex-shrink-0"
        style={{
          padding: '0 1rem',
          borderBottom: `1px solid ${S.border}`,
        }}
      >
        {collapsed
          ? <LeafLogo size="sm" />
          : <TahiWordmark size="sm" light />
        }
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: '0.75rem 0.5rem' }}>
        {visibleNav.map((group, gi) => (
          <div key={group.group} style={{ marginTop: gi > 0 ? '1.25rem' : 0 }}>
            {!collapsed && (
              <p style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: S.groupLabel,
                padding: '0 0.5rem',
                marginBottom: '0.25rem',
              }}>
                {group.group}
              </p>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {group.items.map(item => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/requests' && item.href !== '/overview' && pathname.startsWith(item.href))

                return (
                  <li key={item.href} style={{ marginBottom: '2px' }}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className="flex items-center transition-colors"
                      style={{
                        gap: '10px',
                        padding: collapsed ? '8px 0' : '7px 8px',
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        borderRadius: '6px',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        color: isActive ? S.textActive : S.textMuted,
                        background: isActive ? S.bgActive : 'transparent',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = S.bgHover
                          e.currentTarget.style.color = S.textActive
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = S.textMuted
                        }
                      }}
                    >
                      <span style={{ color: isActive ? S.iconActive : S.iconMuted, display: 'flex', flexShrink: 0 }}>
                        <Icon className={cn(collapsed ? 'w-5 h-5' : 'w-4 h-4')} />
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

      {/* Footer: dark mode + collapse */}
      <div style={{ padding: '8px', borderTop: `1px solid ${S.border}`, flexShrink: 0 }}>
        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="flex items-center transition-colors w-full"
          style={{
            gap: '10px',
            padding: collapsed ? '8px 0' : '7px 8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: '6px',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: S.textMuted,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginBottom: '2px',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = S.bgHover; e.currentTarget.style.color = S.textActive }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.textMuted }}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span style={{ color: S.iconMuted, display: 'flex', flexShrink: 0 }}>
            {darkMode
              ? <Sun className="w-4 h-4" />
              : <Moon className="w-4 h-4" />
            }
          </span>
          {!collapsed && <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => {
            const next = !collapsed
            setCollapsed(next)
            try { localStorage.setItem('tahi-sidebar', next ? 'collapsed' : 'expanded') } catch { /* noop */ }
          }}
          className="flex items-center transition-colors w-full"
          style={{
            gap: '10px',
            padding: collapsed ? '8px 0' : '7px 8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: '6px',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: S.textMuted,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = S.bgHover; e.currentTarget.style.color = S.textActive }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.textMuted }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span style={{ color: S.iconMuted, display: 'flex', flexShrink: 0 }}>
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
