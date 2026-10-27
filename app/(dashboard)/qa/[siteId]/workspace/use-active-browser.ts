'use client'

import { useEffect, useState } from 'react'
import { detectBrowser } from '@/lib/qa/browsers'
import { QA_DEFAULT_BROWSER, type QaBrowserKey } from '@/lib/qa/types'

export interface ActiveBrowser {
  /** The browser every tick, scan and comment in the workspace is recorded against. */
  activeBrowser: QaBrowserKey
  /** The engine of the browser the dashboard is open in. Chrome until the first effect runs. */
  detected: QaBrowserKey
  /** Set when something other than detection chose the active browser, otherwise null. */
  override: QaBrowserKey | null
  /** Overrides detection (null goes back to it). Not used yet: a later local helper renders Firefox and Safari snapshots inside Chrome and will switch the engine here. */
  setOverride: (browser: QaBrowserKey | null) => void
}

/**
 * The browser the workspace is testing in. A page renders with the engine of the browser it is open
 * in, so by default this is detected from the user agent. It is detected after mount so the server
 * markup and the first client render agree. Callers read activeBrowser and never detected, so an
 * override can replace detection without touching them.
 */
export function useActiveBrowser(): ActiveBrowser {
  const [detected, setDetected] = useState<QaBrowserKey>(QA_DEFAULT_BROWSER)
  const [override, setOverride] = useState<QaBrowserKey | null>(null)

  useEffect(() => {
    setDetected(detectBrowser(navigator.userAgent))
  }, [])

  return { activeBrowser: override ?? detected, detected, override, setOverride }
}
