'use client'

import { useState, useEffect } from 'react'
import { OrganizationSwitcher } from '@clerk/nextjs'
import { Search, Eye, UserCog } from 'lucide-react'
import { NotificationBell } from './notification-bell'
import { useImpersonation } from './impersonation-banner'
import { CurrencySwitcher } from './currency-switcher'
import { TimerChip } from './timer-chip'
import { Tooltip } from './tooltip'
import { SearchPalette } from './search-palette'

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const {
    isImpersonatingClient,
    isImpersonatingTeamMember,
    impersonatedContactName,
    impersonatedOrgName,
    impersonatedTeamMemberName,
  } = useImpersonation()

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
    <header
      className="flex items-center flex-shrink-0"
      style={{
        height: '3.5rem',
        padding: '0 var(--space-6)',
        gap: 'var(--space-3)',
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Left region: impersonation, search, or client portal switcher. */}
      <div className="flex items-center flex-1 min-w-0" style={{ gap: 'var(--space-3)' }}>
        {isAdmin && isImpersonatingClient ? (
          <ImpersonationLabel
            icon={<Eye size={15} aria-hidden="true" />}
            iconColour="var(--color-warning)"
            text={impersonatedContactName
              ? `${impersonatedContactName} at ${impersonatedOrgName ?? 'client'}`
              : (impersonatedOrgName ?? 'Client')}
          />
        ) : isAdmin && isImpersonatingTeamMember ? (
          <ImpersonationLabel
            icon={<UserCog size={15} aria-hidden="true" />}
            iconColour="var(--color-info)"
            text={`Viewing as ${impersonatedTeamMemberName ?? 'team member'}`}
          />
        ) : isAdmin ? (
          <>
            {/* Desktop search trigger. Uses the dashboard's Input.Group
                shape so it visually matches every other form field in
                the app. The trigger itself is a button that opens the
                full-screen search overlay. */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="hidden md:flex items-center"
              style={{
                height: '2.25rem',
                width: '100%',
                maxWidth: '24rem',
                minWidth: '14rem',
                padding: '0 var(--space-2)',
                gap: 'var(--space-2)',
                background: 'var(--color-bg)',
                border: `1px solid ${searchFocused ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                boxShadow: searchFocused ? 'var(--shadow-ring)' : 'none',
                cursor: 'pointer',
                outline: 'none',
                transition:
                  'border-color 150ms ease, box-shadow 150ms ease',
              }}
              onMouseEnter={e => {
                if (searchFocused) return
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
              onMouseLeave={e => {
                if (searchFocused) return
                e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
              }}
              aria-label="Open search"
            >
              <Search
                size={15}
                aria-hidden="true"
                style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }}
              />
              <span
                className="flex-1 text-left truncate"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 400,
                  color: 'var(--color-text-subtle)',
                }}
              >
                Search the dashboard
              </span>
              <KbdHint />
            </button>

            {/* Mobile search icon */}
            <Tooltip label="Search" side="bottom">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="md:hidden flex items-center justify-center"
                style={{
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease, color 150ms ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                  e.currentTarget.style.color = 'var(--color-text)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
                aria-label="Search"
              >
                <Search size={18} aria-hidden="true" />
              </button>
            </Tooltip>
          </>
        ) : (
          <OrganizationSwitcher
            hidePersonal
            appearance={{
              elements: {
                organizationSwitcherTrigger:
                  'text-sm font-medium hover:opacity-80 rounded-md px-2 py-1.5 transition-colors',
              },
            }}
          />
        )}
      </div>

      {/* Right cluster. Identity sits in the SidebarUserCard, so the
          top-nav right side is just live tools (timer, currency) and
          alerts (notifications). A hairline divider separates the two
          groups so it reads as "tools | alerts" rather than three
          unrelated buttons. */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
        {isAdmin && (
          <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
            <TimerChip />
            <CurrencySwitcher />
          </div>
        )}
        {isAdmin && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '1px',
              height: '1.25rem',
              background: 'var(--color-border-subtle)',
              margin: '0 var(--space-1)',
            }}
          />
        )}
        <NotificationBell />
      </div>

      {/* Global search palette. Handles its own input + results. */}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}

// Subtle keyboard-shortcut hint inside the search pill.
function KbdHint() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.0625rem',
        flexShrink: 0,
        padding: '0.0625rem var(--space-1-5)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-subtle)',
        fontSize: '0.6875rem',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontWeight: 500,
        lineHeight: 1.3,
      }}
      aria-hidden="true"
    >
      <span aria-hidden="true">{'⌘'}</span>
      <span aria-hidden="true">K</span>
    </span>
  )
}

// Compact impersonation indicator used in the top-nav left region.
function ImpersonationLabel({
  icon,
  iconColour,
  text,
}: {
  icon: React.ReactNode
  iconColour: string
  text: string
}) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: 'var(--space-2)',
        padding: 'var(--space-1-5) var(--space-3)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        height: '2.25rem',
        minWidth: 0,
      }}
    >
      <span style={{ color: iconColour, flexShrink: 0, display: 'inline-flex' }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </div>
  )
}
