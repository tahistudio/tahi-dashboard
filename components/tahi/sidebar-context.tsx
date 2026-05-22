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

// useLayoutEffect on the client, useEffect on the server. Avoids
// SSR warnings while still running before paint on the client.
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Always start expanded on both server and client. This matches the
  // SSR HTML so React doesn't see a hydration mismatch (and can't tear
  // down the tree to recover from one). The actual collapsed state is
  // read from the data-sidebar attribute (set by the inline script in
  // app/layout.tsx) in a layout effect below. useLayoutEffect runs
  // synchronously after the React commit and BEFORE the browser paints,
  // so the first visible frame already shows the correct state.
  const [collapsed, setCollapsedState] = React.useState(false)
  const [mobileOpen, setMobileOpenState] = React.useState(false)

  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined') return
    let want = false
    if (document.documentElement.getAttribute('data-sidebar') === 'collapsed') {
      want = true
    } else {
      try {
        if (localStorage.getItem(STORAGE_KEY) === 'collapsed') want = true
      } catch {
        // localStorage unavailable
      }
    }
    if (want) setCollapsedState(true)
    // Run once on mount.
  }, [])

  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next)
    // Write straight to localStorage AND the DOM attribute. Keeping
    // both in lock-step removes the need for a React useEffect to
    // sync the attribute, which had a small window where transitions
    // could trigger from the attribute mutation.
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
      if (next) document.documentElement.setAttribute('data-sidebar', 'collapsed')
      else document.documentElement.removeAttribute('data-sidebar')
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
