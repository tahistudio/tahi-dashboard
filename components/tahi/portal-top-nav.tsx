'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Bell } from 'lucide-react'

export function PortalTopNav() {
  return (
    <header className="h-16 flex items-center justify-between px-6 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex-shrink-0">
      {/* Org switcher (for multi-brand clients) */}
      <OrganizationSwitcher
        hidePersonal
        appearance={{
          elements: {
            organizationSwitcherTrigger:
              'text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] rounded-lg px-2 py-1.5 transition-colors',
          },
        }}
      />

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button
          className="relative p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
        </button>

        <UserButton
          appearance={{
            elements: {
              avatarBox: 'w-8 h-8',
            },
          }}
        />
      </div>
    </header>
  )
}
