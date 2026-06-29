'use client'

/**
 * <AppTopNav>. The hairline top bar (Studio Ledger / "Tahi App Shell" design).
 *
 * Left: breadcrumb (group / page), resolved from the shared nav model.
 * Right: command-palette search trigger, then the live tools (time tracker,
 * currency) and alerts (notifications). Impersonation is shown by the dedicated
 * <ImpersonationBanner> strip above this bar, not here.
 */

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { NotificationBell } from './notification-bell'
import { CurrencySwitcher } from './currency-switcher'
import { TimerChip } from './timer-chip'
import { resolveCrumb } from './nav-model'

// SearchPalette is a large command palette only mounted when open -- defer it.
const SearchPalette = dynamic(
  () => import('./search-palette').then(m => ({ default: m.SearchPalette })),
  { ssr: false }
)

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const pathname = usePathname()
  const crumb = resolveCrumb(pathname, isAdmin)

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleGlobalKey)
    return () => document.removeEventListener('keydown', handleGlobalKey)
  }, [])

  return (
    <header className="tahi-topbar">
      <div className="tb-crumb">
        {crumb.group && (
          <>
            <span>{crumb.group}</span>
            <span className="sep" aria-hidden="true">/</span>
          </>
        )}
        <span className="here">{crumb.label}</span>
      </div>

      {/* Desktop command-palette trigger. */}
      {isAdmin && (
        <button
          type="button"
          className="tb-search hidden md:flex"
          onClick={() => setSearchOpen(true)}
          aria-label="Search the dashboard"
        >
          <ShellIcon n="search" s={16} />
          <span>Search or jump to...</span>
          <span className="kbd" aria-hidden="true">
            <span>{'⌘'}</span>
            <span>K</span>
          </span>
        </button>
      )}

      {/* Right cluster: tools + alerts. When there is no search trigger (client
          portal) this cluster carries the auto margin so it sits flush right. */}
      <div className="tb-controls" style={!isAdmin ? { marginLeft: 'auto' } : undefined}>
        {isAdmin && (
          <button
            type="button"
            className="tb-bell md:hidden"
            onClick={() => setSearchOpen(true)}
            aria-label="Search the dashboard"
          >
            <ShellIcon n="search" s={18} />
          </button>
        )}
        {isAdmin && <TimerChip />}
        {isAdmin && <span className="tb-divider" aria-hidden="true" />}
        <NotificationBell />
        <CurrencySwitcher />
      </div>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
