'use client'

/**
 * Layout for the public, no-auth document viewers (`/p/proposal`,
 * `/p/schedule`, `/p/contract`).
 *
 * Two jobs:
 *
 * 1. Keep dashboard dark mode out. These documents are print-like
 *    artefacts prepared for an external prospect or client: a visitor who
 *    once toggled the dashboard's dark mode on this same browser must not
 *    have that preference bleed into a shared proposal or schedule link.
 *    The blocking theme script in `app/layout.tsx` skips /p/ paths, so a
 *    direct load never gets `.dark` at all (it used to add it and let this
 *    effect remove it after hydration, a visible dark flash). The effect
 *    below stays for a client-side navigation into /p/ from the dashboard,
 *    where no blocking script runs and `.dark` is already on <html>.
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
