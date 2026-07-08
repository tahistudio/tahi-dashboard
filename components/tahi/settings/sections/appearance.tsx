'use client'

import { useEffect, useState } from 'react'
import { SectionShell, Toggle } from '@/components/tahi/settings/primitives'

/**
 * Appearance settings section (design parity: settings-app.jsx Appearance).
 * Shown to both admin and clients.
 *
 * All three preferences are device-level, so they live in localStorage
 * (the one place the repo rules allow it):
 *   - `tahi-theme`                  drives the `dark` class on <html>
 *   - `tahi-reduce-motion`          drives the `reduce-motion` class on <html>
 *   - `tahi-sidebar-start-collapsed` seeds each new browser session with the
 *     rail collapsed (the pre-hydration script in app/layout.tsx writes the
 *     regular `tahi-sidebar` key once per session, so the in-session chevron
 *     toggle is never fought).
 *
 * The dark toggle also tracks external changes (top-nav toggle in this tab via
 * a class observer, other tabs via the storage event) so it never goes stale.
 */

const THEME_KEY = 'tahi-theme'
const REDUCE_KEY = 'tahi-reduce-motion'
const START_COLLAPSED_KEY = 'tahi-sidebar-start-collapsed'

function readDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function AppearanceSection() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [motion, setMotion] = useState(false)
  const [startCollapsed, setStartCollapsed] = useState(false)

  useEffect(() => {
    // Read the live document state on mount (the pre-hydration script has
    // already applied both classes from localStorage).
    setTheme(readDark() ? 'dark' : 'light')
    setMotion(document.documentElement.classList.contains('reduce-motion'))
    try {
      setStartCollapsed(localStorage.getItem(START_COLLAPSED_KEY) === 'true')
    } catch {
      // localStorage unavailable; leave the default.
    }

    // Same-tab external changes (e.g. a top-nav theme toggle) mutate the html
    // class list directly, so observe it.
    const observer = new MutationObserver(() => {
      setTheme(readDark() ? 'dark' : 'light')
      setMotion(document.documentElement.classList.contains('reduce-motion'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    // Cross-tab changes arrive via the storage event; mirror them onto this
    // document so the whole tab follows, not just the toggle.
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) {
        document.documentElement.classList.toggle('dark', e.newValue === 'dark')
        setTheme(e.newValue === 'dark' ? 'dark' : 'light')
      } else if (e.key === REDUCE_KEY) {
        document.documentElement.classList.toggle('reduce-motion', e.newValue === 'true')
        setMotion(e.newValue === 'true')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // localStorage unavailable; the class still applies for this page view.
    }
    setTheme(next)
  }

  function toggleMotion() {
    const next = !motion
    document.documentElement.classList.toggle('reduce-motion', next)
    try {
      localStorage.setItem(REDUCE_KEY, next ? 'true' : 'false')
    } catch {
      // localStorage unavailable; the class still applies for this page view.
    }
    setMotion(next)
  }

  function toggleStartCollapsed() {
    const next = !startCollapsed
    try {
      localStorage.setItem(START_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // localStorage unavailable; nothing to persist.
    }
    setStartCollapsed(next)
  }

  return (
    <SectionShell title="Appearance" lede="How the studio looks and feels on this device. Saved to this browser only.">
      <div className="set-card">
        <div className="set-row">
          <div className="sr-t">
            <b>Dark mode</b>
            <small>Switch the canvas to the dark palette. The rail stays forest.</small>
          </div>
          <Toggle on={theme === 'dark'} onClick={toggleTheme} ariaLabel="Toggle dark mode" />
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b>Reduce motion</b>
            <small>Minimise animations and transitions across the app.</small>
          </div>
          <Toggle on={motion} onClick={toggleMotion} ariaLabel="Toggle reduce motion" />
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b>Start with sidebar collapsed</b>
            <small>Open each session with the rail as a narrow icon strip.</small>
          </div>
          <Toggle on={startCollapsed} onClick={toggleStartCollapsed} ariaLabel="Toggle start with sidebar collapsed" />
        </div>
      </div>
    </SectionShell>
  )
}
