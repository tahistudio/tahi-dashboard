'use client'

/**
 * <SidebarUserCard>. The forest rail's account control, pinned to the bottom of
 * the sidebar (Studio Ledger / "Tahi App Shell" design).
 *
 * Expanded: avatar + name + email + menu dots. Collapsed: just the avatar (with
 * a body-level name tooltip via data-tip). Tap opens the dark .uc-menu popover
 * (bare Popover - the menu owns its forest chrome) with Theme, Private mode and
 * Client view (super-admin only), Settings and Sign out.
 *
 * Wiring: Clerk useUser() / signOut(); Client view previews the portal via
 * impersonation; Private mode blurs data-private surfaces for screen-shares.
 * Client view + Private mode stay gated to the super-admin allowlist - that is
 * the real boundary, not a cosmetic one.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Sun, Moon, Settings, LogOut, Eye, EyeOff, MoreVertical } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { apiPath } from '@/lib/api'
import { setImpersonation } from '@/components/tahi/impersonation-banner'
import { usePrivateMode } from '@/components/tahi/private-mode-context'
import { useToast } from '@/components/tahi/toast'

interface SidebarUserCardProps {
  collapsed: boolean
  darkMode: boolean
  onToggleDarkMode: () => void
}

// Super-admin allowlist. Only these emails see Client view / Private mode.
const SUPER_ADMIN_EMAILS = new Set([
  'business@tahi.studio',
  'staci@tahi.studio',
])

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function SidebarUserCard({ collapsed, darkMode, onToggleDarkMode }: SidebarUserCardProps) {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const router = useRouter()
  const { privateMode, togglePrivateMode } = usePrivateMode()
  const { showToast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [loadingClientView, setLoadingClientView] = React.useState(false)
  const [imgError, setImgError] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  // Client view: preview the dashboard as a client sees it by impersonating a
  // real client org (the most recently updated one). The impersonation banner
  // provides the exit. No-op with a toast if there are no clients.
  const handleClientView = React.useCallback(async () => {
    setOpen(false)
    setLoadingClientView(true)
    try {
      const res = await fetch(apiPath('/api/admin/clients?status=active'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { organisations?: Array<{ id: string; name: string }> }
      const first = (data.organisations ?? [])[0]
      if (!first) { showToast('No active clients to preview yet', 'error'); return }
      setImpersonation({ orgId: first.id, orgName: first.name })
      router.push('/overview')
    } catch {
      showToast('Could not start client view', 'error')
    } finally {
      setLoadingClientView(false)
    }
  }, [router, showToast])

  // Loading placeholder so the footer doesn't shift when Clerk data arrives.
  if (!isLoaded || !user) {
    return (
      <div className="user-card" aria-hidden="true">
        <span className="uc-av" style={{ background: 'rgba(158,196,149,0.16)' }} />
        {!collapsed && (
          <span className="uc-t">
            <span style={{ display: 'block', height: '0.625rem', width: '70%', background: 'rgba(158,196,149,0.16)', borderRadius: 4, marginBottom: 6 }} />
            <span style={{ display: 'block', height: '0.5rem', width: '90%', background: 'rgba(158,196,149,0.12)', borderRadius: 4 }} />
          </span>
        )}
      </div>
    )
  }

  const fullName = user.fullName || user.firstName || user.username || 'Account'
  const email = user.primaryEmailAddress?.emailAddress ?? ''
  const imageUrl = user.imageUrl ?? undefined
  const initials = initialsOf(fullName)
  const isSuperAdmin = email ? SUPER_ADMIN_EMAILS.has(email.toLowerCase()) : false

  const handleSignOut = async () => {
    setOpen(false)
    await signOut(() => router.push('/sign-in'))
  }

  const avatar = imageUrl && !imgError
    ? <img src={imageUrl} alt="" onError={() => setImgError(true)} />
    : <>{initials}</>

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${fullName}`}
        data-tip={collapsed ? fullName : undefined}
        className="user-card"
      >
        <span className="uc-av">{avatar}</span>
        <span className="uc-t" data-private>
          <b>{fullName}</b>
          {email && <small>{email}</small>}
        </span>
        <span className="uc-menu-ic"><MoreVertical size={16} /></span>
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="start"
        width="14rem"
        mobileFullWidth
        bare
      >
        <div className="uc-menu" role="menu" aria-label="Account">
          <div className="ucm-head">
            <span className="uc-av">{avatar}</span>
            <div style={{ minWidth: 0 }}>
              <b data-private>{fullName}</b>
              {email && <small data-private>{email}</small>}
            </div>
          </div>
          <div className="ucm-div" />
          <button className="ucm-row" role="menuitem" onClick={() => { onToggleDarkMode(); }}>
            <span className="ucm-ic">{darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</span>
            Theme
            <span className="ucm-state">{darkMode ? 'Dark' : 'Light'}</span>
          </button>
          {isSuperAdmin && (
            <>
              <button className="ucm-row" role="menuitem" onClick={() => { togglePrivateMode() }}>
                <span className="ucm-ic"><EyeOff className="w-4 h-4" /></span>
                Private mode
                <span className="ucm-state">{privateMode ? 'On' : 'Off'}</span>
              </button>
              <button className="ucm-row" role="menuitem" onClick={handleClientView} disabled={loadingClientView}>
                <span className="ucm-ic"><Eye className="w-4 h-4" /></span>
                {loadingClientView ? 'Starting client view...' : 'Client view'}
              </button>
            </>
          )}
          <div className="ucm-div" />
          <Link className="ucm-row" role="menuitem" href="/settings" onClick={() => setOpen(false)}>
            <span className="ucm-ic"><Settings className="w-4 h-4" /></span>
            Settings
          </Link>
          <button className="ucm-row danger" role="menuitem" onClick={handleSignOut}>
            <span className="ucm-ic"><LogOut className="w-4 h-4" /></span>
            Sign out
          </button>
        </div>
      </Popover>
    </>
  )
}
