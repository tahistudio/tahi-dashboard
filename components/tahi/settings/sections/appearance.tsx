'use client'

import { useEffect, useState } from 'react'
import { SectionShell, Toggle } from '@/components/tahi/settings/primitives'

/**
 * Appearance settings section. Shown to both admin and clients.
 *
 * Purely local: the theme preference lives in localStorage under the key
 * `tahi-theme` and drives the `dark` class on <html>. There is no server
 * state, so no endpoint is fetched.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  // Read the persisted preference on mount.
  useEffect(() => {
    const stored = localStorage.getItem('tahi-theme')
    setTheme(stored === 'dark' ? 'dark' : 'light')
  }, [])

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      if (next === 'dark') {
        document.documentElement.classList.add('dark')
        localStorage.setItem('tahi-theme', 'dark')
      } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('tahi-theme', 'light')
      }
      return next
    })
  }

  return (
    <SectionShell title="Appearance" lede="How the studio looks on this device.">
      <div className="set-card">
        <div className="set-row">
          <div className="sr-t">
            <b>Dark mode</b>
            <small>Switch the canvas to the dark palette. The rail stays forest.</small>
          </div>
          <Toggle
            on={theme === 'dark'}
            onClick={toggleTheme}
            ariaLabel="Toggle dark mode"
          />
        </div>
      </div>
    </SectionShell>
  )
}
