'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Bell, Search } from 'lucide-react'

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  return (
    <header
      className="h-14 flex items-center justify-between flex-shrink-0"
      style={{
        padding: '0 1.5rem',
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        {isAdmin ? (
          <button
            className="flex items-center gap-2 transition-colors"
            style={{
              padding: '0.4375rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: 400,
              color: 'var(--color-text-subtle)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-button)',
              cursor: 'pointer',
              maxWidth: '28rem',
              width: '100%',
              minWidth: '12rem',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
              e.currentTarget.style.color = 'var(--color-text-subtle)'
            }}
            aria-label="Search"
          >
            <Search size={14} style={{ flexShrink: 0 }} />
            <span className="flex-1 text-left truncate">Search requests, clients...</span>
            <kbd
              style={{
                fontSize: '0.625rem',
                padding: '0.125rem 0.375rem',
                borderRadius: 4,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-subtle)',
                fontFamily: 'monospace',
                flexShrink: 0,
              }}
            >
              Ctrl+K
            </kbd>
          </button>
        ) : (
          <OrganizationSwitcher
            hidePersonal
            appearance={{
              elements: {
                organizationSwitcherTrigger:
                  'text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors',
              },
            }}
          />
        )}
      </div>

      {/* Right */}
      <div className="flex items-center" style={{ gap: '0.5rem' }}>
        <button
          className="relative flex items-center justify-center transition-colors"
          style={{
            width: '2.25rem',
            height: '2.25rem',
            borderRadius: 'var(--radius-button)',
            color: 'var(--color-text-subtle)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg-secondary)'
            e.currentTarget.style.color = 'var(--color-text)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-subtle)'
          }}
          aria-label="Notifications"
        >
          <Bell size={16} />
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-brand)',
            }}
            aria-hidden="true"
          />
        </button>

        <UserButton
          appearance={{
            elements: { avatarBox: 'w-7 h-7' },
          }}
        />
      </div>
    </header>
  )
}
