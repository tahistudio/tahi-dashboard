'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Bell, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  return (
    <header className="h-16 flex items-center justify-between px-6 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex-shrink-0">
      {/* Left: search or org switcher */}
      <div className="flex items-center gap-3">
        {isAdmin ? (
          /* Admin: global search */
          <button
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] transition-colors"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Search everything...</span>
            <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] font-mono border border-[var(--color-border)]">
              ⌘K
            </kbd>
          </button>
        ) : (
          /* Client: org switcher for multi-brand */
          <OrganizationSwitcher
            hidePersonal
            appearance={{
              elements: {
                organizationSwitcherTrigger:
                  'text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] rounded-lg px-2 py-1.5 transition-colors',
              },
            }}
          />
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {isAdmin && (
          <button
            className={cn(
              'hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90'
            )}
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-leaf-sm)',
            }}
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        )}

        {/* Notifications bell */}
        <button
          className="relative p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {/* Unread dot — wired up to SSE in a later phase */}
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-brand)]"
            aria-hidden="true"
          />
        </button>

        <UserButton
          appearance={{
            elements: { avatarBox: 'w-8 h-8' },
          }}
        />
      </div>
    </header>
  )
}
