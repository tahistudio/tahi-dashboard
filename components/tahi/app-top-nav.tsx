'use client'

/**
 * <AppTopNav>. The hairline top bar (Studio Ledger / "Tahi App Shell" design).
 *
 * From md up, unchanged: breadcrumb on the left, then the command-palette
 * search trigger and the live tools (time tracker, daily brief, notifications,
 * currency) on the right.
 *
 * Below md the bar is five slots and nothing else, because the forest rail is
 * hidden there and the bar was trying to be a toolbar as well as a location:
 *
 *   [back-or-brand] [page name ......] [search] [notifications] [account]
 *
 * Slot 1 is the brand on a top-level route and a back link to the parent
 * segment on a detail route (two or more path segments). On a phone that link
 * is the only in-app way off /requests/{id} back to the list: the rail is
 * hidden and the bottom tabs only reach top-level destinations.
 *
 * The tracker, the brief and the currency switcher stay mounted (they keep
 * polling and heartbeating) but are hidden by CSS and re-offered inside the
 * account sheet, where <TopBarMore> also carries the account controls the rail
 * owns on desktop. See components/tahi/top-bar-more.tsx.
 *
 * Impersonation is shown by the dedicated <ImpersonationBanner> strip above
 * this bar, not here, but it is read here: while previewing the portal as a
 * client the bar hides the studio tools and the bell switches audience, so the
 * preview is honest instead of showing team chrome over client data. Hides,
 * not unmounts, for the tracker: it owns the timer heartbeat.
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { TahiIconMark } from '@/components/tahi/tahi-glyphs'
import { NotificationBell } from './notification-bell'
import { BriefingTrigger } from './briefing-trigger'
import { CurrencySwitcher } from './currency-switcher'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { TimerChip } from './timer-chip'
import { TopBarMore } from './top-bar-more'
import { useImpersonation } from './impersonation-banner'
import { resolveCrumb } from './nav-model'

// SearchPalette is a large command palette only mounted when open -- defer it.
const SearchPalette = dynamic(
  () => import('./search-palette').then(m => ({ default: m.SearchPalette })),
  { ssr: false }
)

interface AppTopNavProps {
  isAdmin: boolean
  // Client-portal brand lockup, resolved server-side by the layout (the same
  // pair the rail gets). Both null for admin/team sessions, so the studio sees
  // the Tahi mark. This is the only place a white-labelled portal's brand
  // appears on a phone, since the rail that normally carries it is hidden.
  brandName?: string | null
  brandLogoUrl?: string | null
}

export function AppTopNav({ isAdmin, brandName, brandLogoUrl }: AppTopNavProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const pathname = usePathname()
  const { isImpersonatingClient } = useImpersonation()
  const { isPinned: currencyPinned } = useDisplayCurrency()

  // Same derivation the rail and the bottom tabs use, so all three surfaces
  // agree on which audience the shell is currently dressed for.
  const showAsAdmin = isAdmin && !isImpersonatingClient
  const crumb = resolveCrumb(pathname, showAsAdmin)

  // Slot 1 below md: back on a detail route, brand on a top-level one. A Link
  // to the parent segment rather than router.back(), so it is a predictable
  // destination even when the detail page was opened from a notification, a
  // deep link or another detail page.
  const segments = pathname.split('/').filter(Boolean)
  const parentHref = segments.length >= 2 ? '/' + segments.slice(0, -1).join('/') : null
  const parentLabel = parentHref ? resolveCrumb(parentHref, showAsAdmin).label : ''

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

  const brandLabel = brandName?.trim() || 'Tahi Studio'

  return (
    <header className="tahi-topbar">
      {/* Phone-only slot 1. The rail owns the lockup and the wayfinding from
          md up, so both variants carry md:hidden. */}
      {parentHref ? (
        <Link
          href={parentHref}
          className="tb-back md:hidden tahi-focus-ring"
          aria-label={`Back to ${parentLabel}`}
        >
          <ShellIcon n="back" s={20} />
        </Link>
      ) : (
        <Link href="/overview" className="tb-brand md:hidden tahi-focus-ring" aria-label={`${brandLabel} home`}>
          {brandLogoUrl && !logoError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoUrl} alt="" onError={() => setLogoError(true)} />
          ) : brandName ? (
            <span className="tb-brand-initial" aria-hidden="true">{brandLabel.charAt(0).toUpperCase()}</span>
          ) : (
            <TahiIconMark size={28} title="Tahi" />
          )}
        </Link>
      )}

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
      {showAsAdmin && (
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
      <div className="tb-controls" style={!showAsAdmin ? { marginLeft: 'auto' } : undefined}>
        {showAsAdmin && (
          <button
            type="button"
            className="tb-bell md:hidden"
            onClick={() => setSearchOpen(true)}
            aria-label="Search the dashboard"
          >
            <ShellIcon n="search" s={18} />
          </button>
        )}
        {/* Kept mounted below md (the tracker must keep heartbeating and the
            brief must keep its unread rule) but hidden: both are re-offered as
            rows inside the account sheet.
            The tracker hangs off isAdmin, not showAsAdmin, and is only HIDDEN
            during a preview. Its 30s heartbeat lives inside <TimerChip> and a
            timer reads as stale after two minutes, so unmounting it for the
            length of a Client view preview was enough to come back to the
            "your timer hasn't heartbeated" recovery prompt offering to log only
            up to when it went quiet. */}
        {isAdmin && (
          <div className={showAsAdmin ? 'hidden md:flex' : 'hidden'}><TimerChip /></div>
        )}
        {showAsAdmin && <span className="tb-divider hidden md:inline-block" aria-hidden="true" />}
        {showAsAdmin && <div className="hidden md:flex"><BriefingTrigger /></div>}
        {/* showAsAdmin here is Tahi-org membership minus an active client
            preview, which is exactly whose notifications the bell should show,
            so it also picks the route map. */}
        <NotificationBell audience={showAsAdmin ? 'team' : 'client'} />
        {/* Client audiences are pinned to their own billing currency, so the
            chip does not render at all: the wrapper goes with it, otherwise
            the bar keeps a gap for a control that is not there. */}
        {!currencyPinned && <div className="hidden md:flex"><CurrencySwitcher /></div>}
        <TopBarMore showAsAdmin={showAsAdmin} />
      </div>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
