'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Bell, Search } from 'lucide-react'

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  return (
    <header className="h-14 flex items-center justify-between px-8 bg-white border-b border-gray-100 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        {isAdmin ? (
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
            aria-label="Search"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-xs">Search...</span>
            <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-white font-mono border border-gray-200 text-gray-400">
              ⌘K
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
      <div className="flex items-center gap-1.5">
        <button
          className="relative p-2 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]"
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
