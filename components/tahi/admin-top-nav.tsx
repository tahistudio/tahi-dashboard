'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import { Bell, Search, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function AdminTopNav() {
  const { user } = useUser()
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex-shrink-0">
      {/* Search */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors',
            searchOpen
              ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand-dark)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)]'
          )}
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
          <span className="hidden sm:inline text-xs">Search...</span>
          <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Quick add */}
        <button
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90 leaf-sm"
          style={{
            background: 'var(--color-brand)',
            borderRadius: 'var(--radius-leaf-sm)',
          }}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New</span>
        </button>

        {/* Notifications */}
        <button
          className="relative p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {/* Unread badge */}
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-brand)]" />
        </button>

        {/* User button (Clerk) */}
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
