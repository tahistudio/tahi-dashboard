'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Search, X, Eye, UserCog } from 'lucide-react'
import { NotificationBell } from './notification-bell'
import { useImpersonation } from './impersonation-banner'

interface AppTopNavProps {
  isAdmin: boolean
}

export function AppTopNav({ isAdmin }: AppTopNavProps) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedContactName, impersonatedOrgName, impersonatedTeamMemberName } = useImpersonation()

  const handleSearch = useCallback(() => {
    const q = searchValue.trim()
    if (q) {
      router.push(`/requests?q=${encodeURIComponent(q)}`)
      setSearchValue('')
      setSearchOpen(false)
    }
  }, [searchValue, router])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
    if (e.key === 'Escape') { setSearchOpen(false); setSearchValue('') }
  }, [handleSearch])

  // Focus input when search opens on mobile
  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus()
  }, [searchOpen])

  // Keyboard shortcut: Ctrl+K to open search
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
      className="flex items-center justify-between flex-shrink-0"
      style={{
        height: '3.5rem',
        padding: '0 var(--space-6)',
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Left */}
      <div className="flex items-center flex-1 min-w-0" style={{ gap: 'var(--space-3)' }}>
        {isAdmin && isImpersonatingClient ? (
          <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
            <Eye size={16} style={{ color: 'var(--color-warning)', flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
              {impersonatedContactName
                ? `${impersonatedContactName} at ${impersonatedOrgName}`
                : impersonatedOrgName}
            </span>
          </div>
        ) : isAdmin && isImpersonatingTeamMember ? (
          <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
            <UserCog size={16} style={{ color: 'var(--color-info)', flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
              Viewing as {impersonatedTeamMemberName}
            </span>
          </div>
        ) : isAdmin ? (
          <>
            {/* Desktop: full search bar */}
            <button
              className="hidden md:flex items-center"
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--text-sm)',
                fontWeight: 400,
                color: 'var(--color-text-subtle)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-lg)',
                maxWidth: '26rem',
                width: '100%',
                minWidth: '14rem',
                height: '2.25rem',
                gap: 'var(--space-2)',
                transition: 'border-color 150ms ease, box-shadow 150ms ease',
              }}
              onClick={() => setSearchOpen(true)}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
                e.currentTarget.style.boxShadow = 'none'
              }}
              aria-label="Search requests and clients"
            >
              <Search size={14} style={{ flexShrink: 0, opacity: 0.5 }} aria-hidden="true" />
              <span className="flex-1 text-left truncate">Search...</span>
              <kbd
                style={{
                  fontSize: '0.625rem',
                  padding: '0.125rem var(--space-1-5)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-subtle)',
                  fontFamily: 'monospace',
                  flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                {'\u2318'}K
              </kbd>
            </button>

            {/* Mobile: search icon button */}
            <button
              className="md:hidden flex items-center justify-center"
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-subtle)',
                background: 'transparent',
                border: 'none',
                transition: 'background-color 150ms ease',
              }}
              onClick={() => setSearchOpen(true)}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
              aria-label="Search"
            >
              <Search size={18} aria-hidden="true" />
            </button>
          </>
        ) : (
          <OrganizationSwitcher
            hidePersonal
            appearance={{
              elements: {
                organizationSwitcherTrigger:
                  'text-sm font-medium hover:opacity-80 rounded-lg px-2 py-1.5 transition-colors',
              },
            }}
          />
        )}
      </div>

      {/* Right */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
        <NotificationBell />
        <UserButton
          appearance={{
            elements: { avatarBox: 'w-7 h-7' },
          }}
        />
      </div>

      {/* Search overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center"
          style={{ background: 'rgba(0,0,0,0.4)', paddingTop: '10vh' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSearchOpen(false)
              setSearchValue('')
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '34rem',
              margin: '0 var(--space-4)',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.1)',
              overflow: 'hidden',
            }}
          >
            <div className="flex items-center" style={{ padding: 'var(--space-4) var(--space-5)', gap: 'var(--space-3)' }}>
              <Search size={18} style={{ color: 'var(--color-brand)', flexShrink: 0 }} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search requests, clients, invoices..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 outline-none"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text)',
                  fontSize: 'var(--text-md)',
                  fontWeight: 500,
                }}
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchValue('') }}
                className="flex items-center justify-center"
                style={{
                  width: '1.5rem',
                  height: '1.5rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-tertiary)',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  fontSize: '0.625rem',
                  fontFamily: 'monospace',
                  transition: 'background-color 150ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-border-subtle)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)' }}
                aria-label="Close search (Escape)"
              >
                Esc
              </button>
            </div>
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                Press <kbd style={{ padding: '0.0625rem var(--space-1)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: '0.625rem', fontFamily: 'monospace' }}>Enter</kbd> to search
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                <kbd style={{ padding: '0.0625rem var(--space-1)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)', fontSize: '0.625rem', fontFamily: 'monospace' }}>Esc</kbd> to close
              </p>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
