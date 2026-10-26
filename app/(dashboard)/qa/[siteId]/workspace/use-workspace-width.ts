'use client'

import { useCallback, useEffect, useState } from 'react'

/** Below this workspace width (rem) the workspace uses the single-frame layout and a Pages sheet. */
export const QA_SINGLE_FRAME_REM = 40
/** Below this workspace width (rem) the page rail starts collapsed to its icon rail. */
export const QA_RAIL_COLLAPSE_REM = 80

/**
 * Measures the width of the element it is attached to (the workspace itself, not the
 * viewport), so the layout follows the room the workspace really has next to the
 * dashboard sidebar. Returns 0 until the first measurement.
 */
export function useWorkspaceWidth(): { ref: (el: HTMLElement | null) => void; width: number } {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  return { ref, width }
}

/** True when a measured width (px) is under a rem threshold. Unmeasured (0) is never narrow. */
export function narrowerThanRem(widthPx: number, rem: number): boolean {
  return widthPx > 0 && widthPx < rem * 16
}
