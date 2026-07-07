'use client'

/**
 * <AppSidebar>. The dashboard's primary navigation - the always-dark forest
 * rail (Studio Ledger / "Tahi App Shell" design).
 *
 * Responsive:
 *   Desktop (>= 1024px) persistent forest rail pinned left. Expand / collapse
 *     (320ms ease-out). Collapsed width 64px shows icons only with body-level
 *     tooltips. Expanded width 240px shows group labels + count badges.
 *   Tablet (768 to 1023px) persistent rail.
 *   Mobile (< 768px) hidden; the bottom tab bar (<MobileBottomNav>) takes over.
 *
 * The forest skin lives in app/(dashboard)/app-shell.css. Width + the no-flash
 * collapse (html[data-sidebar="collapsed"], set by the inline script before
 * hydration) stay on .tahi-sidebar in globals.css - this component only emits
 * the markup + drives the data. The nav model is shared via nav-model.tsx.
 *
 * Accessibility:
 *   - <nav aria-label="Primary"> on the nav region.
 *   - aria-current="page" on the active link.
 *   - aria-expanded + aria-controls on collapsible group buttons.
 *   - Visible focus ring on every interactive element.
 *   - Collapsed-rail labels are exposed via body-level tooltips (data-tip).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { cn } from '@/lib/utils'
import { ADMIN_NAV, CLIENT_NAV, filterNav, isRouteActive, type NavGroup } from '@/components/tahi/nav-model'
import { usePermissions } from '@/components/tahi/permissions-context'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { useSidebar } from '@/components/tahi/sidebar-context'
import { TahiIconMark, TahiStudioWordmark } from '@/components/tahi/tahi-glyphs'
import { SidebarUserCard } from '@/components/tahi/sidebar-user-card'
import { useUser } from '@clerk/nextjs'
import * as React from 'react'

export function AppSidebar({
  isAdmin,
  features,
  brandName,
  brandLogoUrl,
}: {
  isAdmin: boolean
  features?: Record<string, boolean>
  // Client-portal brand lockup. Both undefined for admin/team sessions, so the
  // default Tahi wordmark renders and the admin path stays pixel-identical.
  brandName?: string | null
  brandLogoUrl?: string | null
}) {
  const pathname = usePathname()
  const { collapsed, setCollapsed } = useSidebar()
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()

  // Flag the sidebar "ready" so user-clicked collapse toggles can animate.
  // Deferred two rAF ticks so transitions are off across initial paint and the
  // SidebarProvider's useLayoutEffect catch-up. The inline script already set
  // the width before body parsed, so the first paint is correct with no anim.
  React.useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.documentElement.setAttribute('data-sidebar-ready', '')
      })
    })
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      document.documentElement.removeAttribute('data-sidebar-ready')
    }
  }, [])

  // Collapsed-rail tooltips. A body-level fixed tip escapes the rail's
  // overflow clip. Only [data-tip] elements (set when collapsed) trigger it.
  React.useEffect(() => {
    let tip: HTMLDivElement | null = null
    const show = (el: Element) => {
      const t = el.getAttribute('data-tip')
      if (!t) return
      if (!tip) {
        tip = document.createElement('div')
        tip.className = 'js-tip'
        document.body.appendChild(tip)
      }
      tip.textContent = t
      const r = el.getBoundingClientRect()
      tip.style.top = `${r.top + r.height / 2}px`
      tip.style.left = `${r.right + 13}px`
      requestAnimationFrame(() => tip && tip.classList.add('on'))
    }
    const hide = () => { if (tip) tip.classList.remove('on') }
    const over = (e: Event) => {
      const el = (e.target as Element)?.closest?.('.tahi-sidebar [data-tip]')
      if (el) show(el)
    }
    const out = (e: Event) => {
      const el = (e.target as Element)?.closest?.('.tahi-sidebar [data-tip]')
      if (el) hide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      if (tip) tip.remove()
    }
  }, [])

  // Theme state. Lives here so the SidebarUserCard menu toggle can drive it.
  const [darkMode, setDarkMode] = React.useState(false)
  React.useEffect(() => {
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

  // Collapsible-group state. Default: every group expanded.
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('tahi-sidebar-groups')
      if (stored) setOpenGroups(JSON.parse(stored))
    } catch { /* localStorage unavailable */ }
  }, [])
  const toggleGroup = (groupName: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [groupName]: prev[groupName] === false }
      try { localStorage.setItem('tahi-sidebar-groups', JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }
  // When the rail is collapsed (icon-only), force every group open so the
  // icons stay reachable. The per-group toggle only applies when expanded.
  const isGroupOpen = (g: NavGroup) => collapsed || openGroups[g.group] !== false

  const showAsAdmin = isAdmin && !isImpersonatingClient
  const isViewerRole = isImpersonatingTeamMember
    && impersonatedAccessRules.length > 0
    && impersonatedAccessRules.every(r => r.role === 'viewer')

  // Defer the client-only Clerk email read until after mount to keep the first
  // client render identical to the server (no hydration mismatch on the
  // email-gated Sitemap entry). See git history for the full rationale.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])
  const { user } = useUser()
  const userEmail = mounted ? (user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null) : null
  const { canManagePermissions } = usePermissions()

  const visibleNav = filterNav(showAsAdmin ? ADMIN_NAV : CLIENT_NAV, {
    showAsAdmin,
    isViewerRole,
    userEmail,
    canManagePermissions,
    features,
  })

  const isItemActive = (href: string) => isRouteActive(pathname, href)

  return (
    <aside
      className="tahi-sidebar tahi-rail hidden md:flex flex-col h-full flex-shrink-0"
      aria-label="Primary navigation"
    >
      <SidebarContent
        collapsed={collapsed}
        visibleNav={visibleNav}
        isItemActive={isItemActive}
        isGroupOpen={isGroupOpen}
        toggleGroup={toggleGroup}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        setCollapsed={setCollapsed}
        brandName={brandName}
        brandLogoUrl={brandLogoUrl}
      />
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────
// Sidebar inner content.
// ────────────────────────────────────────────────────────────────────
interface SidebarContentProps {
  collapsed: boolean
  visibleNav: NavGroup[]
  isItemActive: (href: string) => boolean
  isGroupOpen: (g: NavGroup) => boolean
  toggleGroup: (groupName: string) => void
  darkMode: boolean
  toggleDarkMode: () => void
  setCollapsed: (next: boolean) => void
  brandName?: string | null
  brandLogoUrl?: string | null
}

function SidebarContent({
  collapsed,
  visibleNav,
  isItemActive,
  isGroupOpen,
  toggleGroup,
  darkMode,
  toggleDarkMode,
  setCollapsed,
  brandName,
  brandLogoUrl,
}: SidebarContentProps) {
  // A client portal viewer with saved branding gets their own lockup; every
  // other session (admin/team, or a client with no branding set) falls through
  // to the default Tahi wordmark below, unchanged.
  const hasClientBrand = !!(brandLogoUrl || brandName)
  const brandLabel = brandName?.trim() || 'Portal'
  const brandInitial = brandLabel.charAt(0).toUpperCase()
  return (
    <>
      {/* Brand lockup. Wordmark (expanded) + icon-mark tile (collapsed); the
          swap is CSS-driven off [data-sidebar="collapsed"] so it can't flash. */}
      <div className="rail-top">
        <Link
          href="/overview"
          aria-label={hasClientBrand ? `${brandLabel}. Go to overview` : 'Tahi Studio. Go to overview'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none', minWidth: 0 }}
        >
          {hasClientBrand ? (
            <>
              <span className="wm" style={{ color: 'var(--rail-text-active)', minWidth: 0 }}>
                {brandLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brandLogoUrl}
                    alt={brandLabel}
                    style={{ height: 26, maxWidth: 160, objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <span
                    style={{
                      font: "700 1.0625rem 'Manrope', sans-serif",
                      letterSpacing: '-0.01em',
                      color: 'var(--rail-text-active)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 168,
                    }}
                  >
                    {brandLabel}
                  </span>
                )}
              </span>
              <span className="mark-tile" aria-hidden="true">
                {brandLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brandLogoUrl}
                    alt=""
                    style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 10, display: 'block' }}
                  />
                ) : (
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--color-brand)',
                      color: '#fff',
                      font: "700 1rem 'Manrope', sans-serif",
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 14px -4px rgba(0, 0, 0, 0.5)',
                    }}
                  >
                    {brandInitial}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="wm" style={{ color: 'var(--rail-text-active)' }}>
                <TahiStudioWordmark height={26} title="Tahi Studio" />
              </span>
              <span className="mark-tile" aria-hidden="true">
                <TahiIconMark size={36} variant="on-dark" />
              </span>
            </>
          )}
        </Link>
      </div>

      {/* Nav region */}
      <nav aria-label="Primary" className="rail-nav">
        {visibleNav.map((group) => {
          const open = isGroupOpen(group)
          const groupId = 'nav-group-' + group.group.toLowerCase().replace(/\s+/g, '-')
          return (
            <div className={cn('rail-group', !open && 'collapsed')} key={group.group}>
              <button
                className="rail-glabel"
                onClick={() => toggleGroup(group.group)}
                aria-expanded={open}
                aria-controls={groupId}
              >
                <span className="gl-text">{group.group}</span>
                <span className="chev"><ShellIcon n="chevron" s={13} /></span>
              </button>
              <div className="rail-items" id={groupId} aria-hidden={!open}>
                <div className="rail-items-in">
                  {group.items.map(item => {
                    const active = isItemActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        data-tour={`nav-${item.label.toLowerCase()}`}
                        data-tip={collapsed ? item.label : undefined}
                        className={cn('nav-item', active && 'active')}
                      >
                        <span className="ni-ic"><ShellIcon n={item.icon} /></span>
                        <span className="ni-label">{item.label}</span>
                        {item.count != null && <span className="ni-count">{item.count}</span>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* Footer: collapse control + user card. */}
      <div className="rail-foot">
        <button
          className="rail-collapse-foot"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse sidebar"
        >
          <ShellIcon n="collapse" s={16} />
          <span>Collapse</span>
        </button>
        <button
          className="rail-expand"
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          data-tip={collapsed ? 'Expand' : undefined}
        >
          <ShellIcon n="expand" s={18} />
        </button>
        <SidebarUserCard
          collapsed={collapsed}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
        />
      </div>
    </>
  )
}
