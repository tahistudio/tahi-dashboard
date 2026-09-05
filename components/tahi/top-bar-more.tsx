'use client'

/**
 * <TopBarMore>. The phone-only "More" control in the top bar, and the bottom
 * sheet it opens.
 *
 * Why it exists: below md the bar was carrying six controls plus a breadcrumb
 * in 3.5rem, so every button squashed under its own 2.75rem touch target, and
 * the account menu (theme, private mode, client view, settings, sign out) was
 * unreachable at all, because it lives in the forest rail and the rail is
 * `hidden md:flex`. This trigger is the fifth and last slot in the phone bar;
 * everything the bar drops lands in its sheet.
 *
 * Nothing here re-implements a control. The time tracker, the daily brief and
 * the currency switcher are the SAME components the desktop bar renders, asked
 * for their `variant="sheet"` trigger, so their state, their popovers and their
 * data hooks are untouched. Only the account rows are written here, because the
 * rail's <SidebarUserCard> is not mounted on a phone to borrow them from.
 *
 * The trigger wears the viewer's avatar and, while a timer is running, a live
 * dot: moving the tracker into a sheet must not hide that it is running.
 *
 * Sheet chrome is the shell's existing bottom sheet (.msheet-overlay/.msheet,
 * shared with the nav's More sheet) in its surface variant, and the Escape /
 * body-scroll / route-change behaviour comes from the shared useBottomSheet.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { TimerChip } from '@/components/tahi/timer-chip'
import { BriefingTrigger } from '@/components/tahi/briefing-trigger'
import { CurrencySwitcher } from '@/components/tahi/currency-switcher'
import { useBottomSheet } from '@/components/tahi/use-bottom-sheet'
import { initialsOf } from '@/components/tahi/sidebar-user-card'
import { usePrivateMode } from '@/components/tahi/private-mode-context'
import { usePermissions } from '@/components/tahi/permissions-context'
import { useToast } from '@/components/tahi/toast'
import { setImpersonation } from '@/components/tahi/impersonation-banner'
import { apiPath } from '@/lib/api'
import { subscribeToTimerChanges } from '@/lib/timer-events'
import { buildMoreSections, type MoreItemId } from '@/lib/top-bar-more-items'

const THEME_KEY = 'tahi-theme'

type TimerStatus = 'idle' | 'running' | 'paused'

interface TopBarMoreProps {
  /** Studio session AND not previewing the portal as a client. Gates the
   *  studio-only tools exactly as the rail and the bottom tabs do. */
  showAsAdmin: boolean
}

export function TopBarMore({ showAsAdmin }: TopBarMoreProps) {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const { privateMode, togglePrivateMode } = usePrivateMode()
  const { isSuperAdmin } = usePermissions()
  const { showToast } = useToast()

  const [open, setOpen] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [dark, setDark] = useState(false)
  const [timerStatus, setTimerStatus] = useState<TimerStatus>('idle')
  const [loadingClientView, setLoadingClientView] = useState(false)

  const close = useCallback(() => setOpen(false), [])
  useBottomSheet(open, close)

  // ── live timer dot ────────────────────────────────────────────────────────
  // One read on mount, then whatever the shared timer bus announces. Every
  // component that mutates a timer calls notifyTimerChanged(), including the
  // <TimerChip> inside this sheet, so the dot follows without a poll of its own.
  const readTimer = useCallback(async () => {
    if (!showAsAdmin) return
    try {
      const res = await fetch(apiPath('/api/admin/timers'))
      if (!res.ok) return
      const data = await res.json() as { timer: { isPaused: boolean } | null }
      setTimerStatus(!data.timer ? 'idle' : data.timer.isPaused ? 'paused' : 'running')
    } catch {
      // offline or transient: leave the dot as it is rather than lying.
    }
  }, [showAsAdmin])

  useEffect(() => { void readTimer() }, [readTimer])
  useEffect(() => subscribeToTimerChanges(() => { void readTimer() }), [readTimer])

  // ── theme ─────────────────────────────────────────────────────────────────
  // Read the live document rather than storage: the pre-hydration script in
  // app/layout.tsx has already applied the class, and the rail's own toggle
  // mutates the same class.
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')) }, [])

  const toggleTheme = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
    } catch {
      // localStorage unavailable; the class still applies for this page view.
    }
    setDark(next)
  }, [])

  // ── account actions ───────────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    setOpen(false)
    await signOut(() => router.push('/sign-in'))
  }, [signOut, router])

  // Preview the portal as a real client org (the most recently updated one),
  // mirroring the rail's Client view. The impersonation strip owns the exit.
  const handleClientView = useCallback(async () => {
    setLoadingClientView(true)
    try {
      const res = await fetch(apiPath('/api/admin/clients?status=active'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { organisations?: Array<{ id: string; name: string }> }
      const first = (data.organisations ?? [])[0]
      if (!first) { showToast('No active clients to preview yet', 'error'); return }
      setImpersonation({ orgId: first.id, orgName: first.name })
      setOpen(false)
      router.push('/overview')
    } catch {
      showToast('Could not start client view', 'error')
    } finally {
      setLoadingClientView(false)
    }
  }, [router, showToast])

  const fullName = user?.fullName || user?.firstName || user?.username || 'Account'
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const imageUrl = user?.imageUrl
  // Before Clerk resolves, an empty tinted circle rather than the initials of
  // the "Account" placeholder, so the mark does not change letters on load.
  const avatar = !isLoaded
    ? null
    : imageUrl && !imgError
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={imageUrl} alt="" onError={() => setImgError(true)} />
      : <>{initialsOf(fullName)}</>

  const sections = buildMoreSections({ showAsAdmin, isSuperAdmin })

  function renderItem(id: MoreItemId): ReactNode {
    switch (id) {
      case 'timer':
        return <div className="tbs-slot"><TimerChip variant="sheet" /></div>
      case 'brief':
        return <BriefingTrigger variant="sheet" />
      case 'currency':
        return <CurrencySwitcher variant="sheet" />
      case 'theme':
        return (
          <button type="button" className="tbs-row tahi-focus-ring" onClick={toggleTheme}>
            <span className="tbs-ic"><ShellIcon n={dark ? 'sun' : 'theme'} s={18} /></span>
            <span className="tbs-lbl">Theme</span>
            <span className="tbs-val">{dark ? 'Dark' : 'Light'}</span>
          </button>
        )
      case 'privateMode':
        return (
          <button type="button" className="tbs-row tahi-focus-ring" onClick={togglePrivateMode}>
            <span className="tbs-ic"><ShellIcon n="private" s={18} /></span>
            <span className="tbs-lbl">Private mode</span>
            <span className={'tbs-val' + (privateMode ? ' on' : '')}>{privateMode ? 'On' : 'Off'}</span>
          </button>
        )
      case 'clientView':
        return (
          <button
            type="button"
            className="tbs-row tahi-focus-ring"
            onClick={() => void handleClientView()}
            disabled={loadingClientView}
          >
            <span className="tbs-ic"><ShellIcon n="impersonate" s={18} /></span>
            <span className="tbs-lbl">{loadingClientView ? 'Starting client view...' : 'Client view'}</span>
          </button>
        )
      case 'settings':
        return (
          <Link href="/settings" className="tbs-row tahi-focus-ring" onClick={close}>
            <span className="tbs-ic"><ShellIcon n="settings" s={18} /></span>
            <span className="tbs-lbl">Settings</span>
          </Link>
        )
      case 'signOut':
        return (
          <button type="button" className="tbs-row danger tahi-focus-ring" onClick={() => void handleSignOut()}>
            <span className="tbs-ic"><ShellIcon n="arrow" s={18} /></span>
            <span className="tbs-lbl">Sign out</span>
          </button>
        )
    }
  }

  const timerRunning = showAsAdmin && timerStatus !== 'idle'

  return (
    <>
      <button
        type="button"
        className="tb-more md:hidden tahi-focus-ring"
        data-timer={timerStatus}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={timerRunning ? `More, timer ${timerStatus}` : 'More'}
      >
        <span className="tb-more-av">{avatar}</span>
        {timerRunning && <span className="tb-more-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="msheet-overlay md:hidden" onClick={close}>
          <div
            className="msheet msheet-surface"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="More"
          >
            <div className="msheet-grab" aria-hidden="true" />

            <div className="tbs-head">
              <span className="tb-more-av">{avatar}</span>
              <span className="tbs-head-t" data-private>
                <b>{fullName}</b>
                {email && <small>{email}</small>}
              </span>
            </div>

            {sections.map(section => (
              <div key={section.id}>
                <div className="ms-glabel">{section.label}</div>
                {section.items.map(id => (
                  <div key={id}>{renderItem(id)}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
