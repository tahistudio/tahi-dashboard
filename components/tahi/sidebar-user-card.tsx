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
import { Sun, Moon, Settings, LogOut, ChevronDown, User as UserIcon } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Popover } from '@/components/tahi/popover'

interface SidebarUserCardProps {
  collapsed: boolean
  darkMode: boolean
  onToggleDarkMode: () => void
}

export function SidebarUserCard({ collapsed, darkMode, onToggleDarkMode }: SidebarUserCardProps) {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  // While Clerk is loading the user, render a skeleton placeholder so
  // the sidebar doesn't shift layout when data arrives.
  if (!isLoaded || !user) {
    return (
      <div
        style={{
          padding: collapsed ? '0.625rem' : '0.625rem 0.75rem',
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
          <div style={{ flex: 1, minWidth: 0 }}>
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
        style={{
          width: '100%',
          padding: collapsed ? '0.5rem' : '0.5rem 0.625rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          justifyContent: collapsed ? 'center' : 'flex-start',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-leaf-sm)',
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
            <div style={{ flex: 1, minWidth: 0 }}>
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
              className="w-3.5 h-3.5"
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
      >
        <div role="menu" aria-label="Account">
          <MenuItem
            icon={<UserIcon className="w-4 h-4" />}
            label="Manage account"
            href="/settings"
            onClick={() => setOpen(false)}
          />
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
}: {
  icon: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
  tone?: 'danger'
}) {
  const colour = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)'
  const hoverBg = tone === 'danger' ? 'var(--color-danger-bg)' : 'var(--color-bg-secondary)'
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
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    textDecoration: 'none',
    transition: 'background var(--motion-quick, 220ms) var(--ease-out, ease-out)',
  }
  const onEnter = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = hoverBg }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }
  if (href) {
    return (
      <Link href={href} role="menuitem" style={style} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <span style={{ color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{icon}</span>
        {label}
      </Link>
    )
  }
  return (
    <button role="menuitem" style={style} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span style={{ color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{icon}</span>
      {label}
    </button>
  )
}
