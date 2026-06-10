'use client'

/**
 * PrivateModeProvider — "screen-share safe" mode (settings popup).
 *
 * When ON, adds `.tahi-private` to <html>; a globals.css rule blurs every
 * element tagged `data-private` (hover to reveal). Tag any sensitive surface
 * (operator identity, client PII, financial figures) with `data-private` and it
 * is masked in private mode. Persists to localStorage and applies on load (no
 * flash), mirroring the dark-mode pattern.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'tahi-private-mode'

interface PrivateModeValue {
  privateMode: boolean
  togglePrivateMode: () => void
}

const PrivateModeContext = createContext<PrivateModeValue>({
  privateMode: false,
  togglePrivateMode: () => {},
})

export function PrivateModeProvider({ children }: { children: React.ReactNode }) {
  const [privateMode, setPrivateMode] = useState(false)

  useEffect(() => {
    try {
      const on = localStorage.getItem(STORAGE_KEY) === '1'
      setPrivateMode(on)
      document.documentElement.classList.toggle('tahi-private', on)
    } catch { /* localStorage unavailable */ }
  }, [])

  const togglePrivateMode = useCallback(() => {
    setPrivateMode(prev => {
      const next = !prev
      try {
        document.documentElement.classList.toggle('tahi-private', next)
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch { /* localStorage unavailable */ }
      return next
    })
  }, [])

  return (
    <PrivateModeContext.Provider value={{ privateMode, togglePrivateMode }}>
      {children}
    </PrivateModeContext.Provider>
  )
}

export function usePrivateMode(): PrivateModeValue {
  return useContext(PrivateModeContext)
}
