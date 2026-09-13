'use client'

/**
 * Layout for the public, no-auth document viewers (`/p/proposal`,
 * `/p/schedule`, `/p/contract`).
 *
 * Two jobs:
 *
 * 1. Strip dashboard dark mode. `app/layout.tsx` runs a blocking inline
 *    script that adds `.dark` to <html> from `localStorage['tahi-theme']`
 *    on every route, including this subtree. These documents are
 *    print-like artefacts prepared for an external prospect or client:
 *    a visitor who once toggled the dashboard's dark mode on this same
 *    browser must not have that preference bleed into a shared proposal
 *    or schedule link. The class is removed on mount so the deliverable
 *    always renders its own light/dark/feature slide theming rather than
 *    the dashboard's ambient theme.
 *
 * 2. Mount <ToastProvider> once for the whole subtree so the public
 *    viewers can surface a real error state instead of a raw alert().
 */

import { useEffect } from 'react'
import { ToastProvider } from '@/components/tahi/toast'

export default function PublicDocumentLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.remove('dark')
  }, [])

  return <ToastProvider>{children}</ToastProvider>
}
