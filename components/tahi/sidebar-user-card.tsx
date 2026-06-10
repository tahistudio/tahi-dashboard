'use client'

/**
 * <SidebarUserCard>. Custom replacement for Clerk's UserButton, pinned
 * to the bottom of the sidebar. Companiya / Donezo style.
 *
 * Expanded: avatar (image or initials) + name + email + chevron. Tap
 * opens a popover with Settings, Theme toggle, and Sign out.
 *
 * Collapsed (rail mode): just the avatar. Tap opens the same popover.
 *
 * Uses Clerk's `useUser()` for the user data and `useClerk().signOut()`
 * for sign-out. Everything else is our own UI so it harmonises with
 * the rest of the dashboard.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Sun, Moon, Settings, LogOut, ChevronDown, Eye, EyeOff, Check } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
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

// Super-admin allowlist. Only these emails see the Demo / Private mode
// menu items. Lowercased for case-insensitive match.
const SUPER_ADMIN_EMAILS = new Set([
  'business@tahi.studio',
  'staci@tahi.studio',
])

export function SidebarUserCard({ collapsed, darkMode, onToggleDarkMode }: SidebarUserCardProps) {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const router = useRouter()
  const { privateMode, togglePrivateMode } = usePrivateMode()
  const { showToast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [loadingClientView, setLoadingClientView] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  // Client view: preview the dashboard as a client sees it by impersonating a
  // real client org (the most recently updated one). The impersonation banner
  // provides the exit. No-op with a toast if there are no clients.
  const handleClientView = React.useCallback(async () => {
    setOpen(false)
    setLoadingClientView(true)
    try {
      const res = await fetch(apiPath('/api/admin/clients'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { clients?: Array<{ id: string; name: string }>; items?: Array<{ id: string; name: string }> }
      const first = (data.clients ?? data.items ?? [])[0]
      if (!first) { showToast('No clients to preview yet', 'error'); return }
      setImpersonation({ orgId: first.id, orgName: first.name })
      router.push('/overview')
    } catch {
      showToast('Could not start client view', 'error')
    } finally {
      setLoadingClientView(false)
    }
  }, [router, showToast])

  // While Clerk is loading the user, render a skeleton placeholder so
  // the sidebar doesn't shift layout when data arrives. Padding flips
  // via CSS keyed off [data-sidebar="collapsed"] so the placeholder
  // doesn't lag React state on refresh.
  if (!isLoaded || !user) {
    return (
      <div
        className="tahi-sidebar-footer-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          minHeight: '3.25rem',
        }}
      >
        <div
          style={{
            width: '2rem', height: '2rem',
            borderRadius: '9999px',
            background: 'var(--color-bg-tertiary)',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        {!collapsed && (
          <div className="tahi-sidebar-expanded-only" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: '0.625rem', background: 'var(--color-bg-tertiary)', borderRadius: '4px', marginBottom: '0.375rem', width: '70%' }} />
            <div style={{ height: '0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '4px', width: '90%' }} />
          </div>
        )}
      </div>
    )
  }

  const fullName = user.fullName || user.firstName || user.username || 'Account'
  const email = user.primaryEmailAddress?.emailAddress ?? ''
  const imageUrl = user.imageUrl ?? undefined
  const isSuperAdmin = email
    ? SUPER_ADMIN_EMAILS.has(email.toLowerCase())
    : false

  const handleSignOut = async () => {
    setOpen(false)
    await signOut(() => router.push('/sign-in'))
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${fullName}`}
        className="tahi-sidebar-footer-btn"
        style={{
          width: '100%',
          // padding + justifyContent come from CSS keyed off
          // [data-sidebar="collapsed"] so they don't lag React state.
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          minHeight: '3rem',
          textAlign: 'left',
          transition: 'background var(--motion-quick, 220ms) var(--ease-out, ease-out)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover-tint)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <Avatar name={fullName} src={imageUrl} size="md" noRing />
        {!collapsed && (
          <>
            <div className="tahi-sidebar-expanded-only" data-private style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--color-text)',
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {fullName}
              </div>
              {email && (
                <div style={{
                  fontSize: '0.6875rem',
                  color: 'var(--color-text-muted)',
                  marginTop: '0.125rem',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {email}
                </div>
              )}
            </div>
            <ChevronDown
              className="w-3.5 h-3.5 tahi-sidebar-expanded-only"
              style={{
                color: 'var(--color-text-subtle)',
                flexShrink: 0,
                transform: open ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform var(--motion-quick, 220ms) var(--ease-out, ease-out)',
              }}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="start"
        width="14rem"
        mobileFullWidth
      >
        <div role="menu" aria-label="Account">
          <MenuItem
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            href="/settings"
            onClick={() => setOpen(false)}
          />
          <MenuItem
            icon={darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            label={darkMode ? 'Light mode' : 'Dark mode'}
            onClick={() => { onToggleDarkMode(); setOpen(false) }}
          />
          {isSuperAdmin && (
            <>
              <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.25rem 0' }} />
              {/* Super-admin-only (liam + staci). Client view previews the
                  client experience via impersonation; Private mode blurs
                  data-private surfaces for screen-shares. */}
              <MenuItem
                icon={<Eye className="w-4 h-4" />}
                label={loadingClientView ? 'Starting client view...' : 'Client view'}
                onClick={handleClientView}
                disabled={loadingClientView}
              />
              <MenuItem
                icon={<EyeOff className="w-4 h-4" />}
                label="Private mode"
                onClick={() => { togglePrivateMode(); setOpen(false) }}
                trailing={privateMode ? <Check className="w-4 h-4" style={{ color: 'var(--color-brand)' }} /> : undefined}
              />
            </>
          )}
          <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.25rem 0' }} />
          <MenuItem
            icon={<LogOut className="w-4 h-4" />}
            label="Sign out"
            onClick={handleSignOut}
            tone="danger"
          />
        </div>
      </Popover>
    </>
  )
}

function MenuItem({
  icon,
  label,
  href,
  onClick,
  tone,
  disabled,
  trailing,
}: {
  icon: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
  tone?: 'danger'
  disabled?: boolean
  trailing?: React.ReactNode
}) {
  const colour = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)'
  const hoverBg = tone === 'danger' ? 'var(--color-danger-bg)' : 'var(--color-bg-secondary)'
  const iconColour = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)'
  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.5rem 0.625rem',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: colour,
    background: 'transparent',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
    textAlign: 'left',
    textDecoration: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--motion-quick, 220ms) var(--ease-out, ease-out)',
  }
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return
    e.currentTarget.style.background = hoverBg
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return
    e.currentTarget.style.background = 'transparent'
  }
  if (href && !disabled) {
    return (
      <Link href={href} role="menuitem" style={style} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <span style={{ color: iconColour }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {trailing}
      </Link>
    )
  }
  return (
    <button
      role="menuitem"
      style={style}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      <span style={{ color: iconColour }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {trailing}
    </button>
  )
}
