'use client'

/**
 * <SidebarProvider>. Shared sidebar state across the dashboard layout.
 *
 *   `collapsed`     desktop sidebar narrow / wide. Persisted to localStorage.
 *   `mobileOpen`    mobile drawer open / closed. Not persisted.
 *
 * The sidebar component itself reads + writes both. The top nav reads
 * mobileOpen + setMobileOpen so it can render the hamburger.
 */

import * as React from 'react'

interface SidebarState {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (next: boolean) => void
}

const SidebarContext = React.createContext<SidebarState | null>(null)

const STORAGE_KEY = 'tahi-sidebar'

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = React.useState(false)
  const [mobileOpen, setMobileOpenState] = React.useState(false)

  // Restore collapsed preference on mount.
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'collapsed') setCollapsedState(true)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      // localStorage unavailable
    }
  }, [])

  // Lock body scroll while mobile drawer is open.
  React.useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [mobileOpen])

  const value = React.useMemo<SidebarState>(() => ({
    collapsed,
    setCollapsed,
    mobileOpen,
    setMobileOpen: setMobileOpenState,
  }), [collapsed, setCollapsed, mobileOpen])

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarState {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) {
    // Fallback when used outside the provider. Defensive: components
    // can still render, they just have no shared state.
    return {
      collapsed: false,
      setCollapsed: () => {},
      mobileOpen: false,
      setMobileOpen: () => {},
    }
  }
  return ctx
}
