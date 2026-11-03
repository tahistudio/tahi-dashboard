'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_VIEW_MODE, VIEW_MODE_STORAGE_KEY, parseViewMode, type QaViewMode } from './inspect-helpers'

/**
 * The workspace view mode (Inspect or Overview) and a setter that remembers the choice.
 * Starts in the default (Inspect) so server and first client markup agree; a saved choice is
 * restored right after mount, before the viewer token has arrived and any frame has mounted.
 */
export function useViewMode(): { mode: QaViewMode; setMode: (next: QaViewMode) => void } {
  const [mode, setModeState] = useState<QaViewMode>(DEFAULT_VIEW_MODE)

  useEffect(() => {
    try {
      setModeState(parseViewMode(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)))
    } catch {
      // Storage can be blocked; the default stands.
    }
  }, [])

  const setMode = useCallback((next: QaViewMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [])

  return { mode, setMode }
}
