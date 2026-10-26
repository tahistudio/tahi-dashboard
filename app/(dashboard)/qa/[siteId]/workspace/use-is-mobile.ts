'use client'

import { useEffect, useState } from 'react'

/** Below 48rem the workspace switches to the single-frame layout. */
export const QA_MOBILE_QUERY = '(max-width: 47.9375rem)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QA_MOBILE_QUERY)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isMobile
}
