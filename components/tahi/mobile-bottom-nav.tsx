'use client'

/**
 * MobileBottomNav - Tahi App Shell forest mobile navigation.
 *
 * A bottom tab bar (4 primary destinations + More) plus a "More" bottom sheet
 * that lists all nav groups from the shared nav model. Navigation items, labels,
 * icons, and visibility rules are driven entirely by nav-model.tsx, so the mobile
 * surface stays in sync with the desktop forest rail automatically.
 *
 * Hidden on md+ breakpoints (desktop uses the persistent forest rail sidebar).
 * Styling tokens live in app/(dashboard)/app-shell.css (.mtabs, .mtab, .mt-ic,
 * .msheet-overlay, .msheet, .msheet-grab, .ms-glabel, .ms-item, .msi-ic,
 * .ms-count). No hardcoded hex in this file.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Inbox, CheckSquare, MessageSquare, FolderOpen,
  Menu, Settings,
} from 'lucide-react'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { useUser } from '@clerk/nextjs'
import { usePermissions } from '@/components/tahi/permissions-context'
import {
  ADMIN_NAV,
  CLIENT_NAV,
  filterNav,
  isRouteActive,
  type NavItem,
} from '@/components/tahi/nav-model'

// ── Primary tab hrefs per audience ──────────────────────────────────────────
// Admin: the 4 core workspace destinations.
// Client: the 4 most-visited portal destinations.
const ADMIN_PRIMARY_HREFS = ['/overview', '/requests', '/tasks', '/messages']
const CLIENT_PRIMARY_HREFS = ['/overview', '/requests', '/messages', '/files']

// Fallback icons used only when an item is absent from the filtered nav (e.g.
// if features are eventually passed and gate a primary tab). Mirrors the
// explicit lists that existed before the nav-model refactor.
const ADMIN_FALLBACK_ICONS: Record<string, NavItem['icon']> = {
  '/overview': LayoutDashboard as NavItem['icon'],
  '/requests': Inbox         as NavItem['icon'],
  '/tasks':    CheckSquare   as NavItem['icon'],
  '/messages': MessageSquare as NavItem['icon'],
}
const CLIENT_FALLBACK_ICONS: Record<string, NavItem['icon']> = {
  '/overview': LayoutDashboard as NavItem['icon'],
  '/requests': Inbox          as NavItem['icon'],
  '/messages': MessageSquare  as NavItem['icon'],
  '/files':    FolderOpen     as NavItem['icon'],
}

interface MobileBottomNavProps {
  isAdmin?: boolean
  features?: Record<string, boolean>
}

export function MobileBottomNav({ isAdmin = false, features }: MobileBottomNavProps) {
  const pathname  = usePathname()
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Mirror the sidebar's showAsAdmin / isViewerRole derivation exactly so
  // the same items appear on both surfaces.
  const showAsAdmin = isAdmin && !isImpersonatingClient
  const isViewerRole =
    isImpersonatingTeamMember &&
    impersonatedAccessRules.length > 0 &&
    impersonatedAccessRules.every(r => r.role === 'viewer')

  // Defer the Clerk email read until after mount so the first client render
  // matches the server (avoids hydration mismatch on the email-gated Sitemap
  // entry). This is the same mounted gate used by the sidebar.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const { user } = useUser()
  const userEmail = mounted
    ? (user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null)
    : null
  const { canManagePermissions } = usePermissions()

  // Feature flags come from the server-resolved permission map (passed by the
  // layout), so the mobile nav hides the same feature-gated items as the rail.
  const visibleGroups = filterNav(showAsAdmin ? ADMIN_NAV : CLIENT_NAV, {
    showAsAdmin,
    isViewerRole,
    userEmail,
    canManagePermissions,
    features,
  })

  // Flat lookup: href -> NavItem. Lets primary tabs pull label + icon from the
  // live filtered nav so labels always match the desktop sidebar.
  const itemMap = new Map<string, NavItem>(
    visibleGroups.flatMap(g => g.items.map(it => [it.href, it] as const)),
  )

  const fallbackIcons = showAsAdmin ? ADMIN_FALLBACK_ICONS : CLIENT_FALLBACK_ICONS
  const primaryHrefs  = showAsAdmin ? ADMIN_PRIMARY_HREFS  : CLIENT_PRIMARY_HREFS
  const primaryTabs   = primaryHrefs.map(href => {
    const item = itemMap.get(href)
    return {
      href,
      label: item?.label ?? href.slice(1),
      icon:  item?.icon  ?? fallbackIcons[href] ?? (Menu as NavItem['icon']),
    }
  })

  const active     = (href: string) => isRouteActive(pathname, href)
  const closeSheet = () => setSheetOpen(false)

  // Close sheet when the route changes (link was tapped inside the sheet).
  useEffect(() => { closeSheet() }, [pathname])

  // Dismiss sheet on Escape for keyboard accessibility.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  // Lock body scroll while sheet is open.
  useEffect(() => {
    if (!sheetOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [sheetOpen])

  return (
    <>
      {/* ── Bottom tab bar ─────────────────────────────────────────────
          Fixed to the bottom of the viewport. Hidden on md+ breakpoints
          where the forest rail takes over.                              */}
      <nav
        className="mtabs fixed bottom-0 inset-x-0 md:hidden"
        style={{ zIndex: 50 }}
        aria-label="Primary"
      >
        {primaryTabs.map(t => {
          const Icon    = t.icon
          const isActive = active(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={'mtab' + (isActive ? ' active' : '')}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="mt-ic" aria-hidden="true"><Icon /></span>
              {t.label}
            </Link>
          )
        })}

        <button
          className="mtab"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-label="Open full navigation menu"
        >
          <span className="mt-ic" aria-hidden="true"><Menu size={20} /></span>
          More
        </button>
      </nav>

      {/* ── More bottom sheet ───────────────────────────────────────────
          Lists ALL filtered nav groups (same filterNav pass as the tabs)
          so nothing is hidden. Settings row pinned at the bottom.
          Overlay click and Escape both dismiss.                          */}
      {sheetOpen && (
        <div className="msheet-overlay md:hidden" onClick={closeSheet}>
          <div
            className="msheet"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
          >
            <div className="msheet-grab" aria-hidden="true" />

            {visibleGroups.map(g => (
              <div key={g.group}>
                <div className="ms-glabel">{g.group}</div>
                {g.items.map(it => {
                  const Icon     = it.icon
                  const isActive = active(it.href)
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={'ms-item' + (isActive ? ' active' : '')}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={closeSheet}
                    >
                      <span className="msi-ic" aria-hidden="true"><Icon /></span>
                      {it.label}
                      {it.count != null && (
                        <span className="ms-count">{it.count}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            ))}

            {/* Settings row pinned below a blank group label divider. */}
            <div className="ms-glabel">&nbsp;</div>
            <Link
              href="/settings"
              className={'ms-item' + (active('/settings') ? ' active' : '')}
              aria-current={active('/settings') ? 'page' : undefined}
              onClick={closeSheet}
            >
              <span className="msi-ic" aria-hidden="true">
                <Settings size={18} />
              </span>
              Settings
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
