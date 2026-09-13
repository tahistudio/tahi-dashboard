'use client'

import { useEffect, useState } from 'react'

/**
 * Simple viewport-width hook for "stack as cards on mobile" decisions.
 * SSR-safe: returns false on first render, then updates after mount.
 *
 * Hoisted out of components/tahi/schedule-section-renderers.tsx (where it
 * used to live as a private helper) so other public-viewer surfaces (the
 * proposal section blocks, the gantt strip) can share the same narrow-mode
 * threshold instead of redefining it.
 */
export function useIsNarrow(breakpointPx = 720): boolean {
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => setIsNarrow(window.innerWidth < breakpointPx)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpointPx])
  return isNarrow
}
