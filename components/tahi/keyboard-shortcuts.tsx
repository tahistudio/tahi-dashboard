'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

/**
 * Global keyboard shortcuts for the dashboard.
 *
 * N - New request (opens the new request dialog via URL param)
 * C - New client (navigates to clients with new=1 param)
 * / - Focus search (delegates to Ctrl+K handler in top nav)
 *
 * Shortcuts are disabled when the user is typing in an input, textarea,
 * select, or contentEditable element.
 */
export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const tagName = target.tagName.toLowerCase()

      // Skip when user is typing
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target.isContentEditable
      ) {
        return
      }

      // Skip when modifier keys are held (except shift)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault()
          if (pathname.startsWith('/requests')) {
            router.push('/requests?new=1')
          } else {
            router.push('/requests?new=1')
          }
          break

        case 'c':
          e.preventDefault()
          router.push('/clients?new=1')
          break

        case '/':
          e.preventDefault()
          // Trigger the command palette / search
          const searchBtn = document.querySelector('[data-tour="nav-search"]') as HTMLElement | null
          if (searchBtn) {
            searchBtn.click()
          } else {
            // Fallback: dispatch Ctrl+K
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
          }
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [router, pathname])

  return null
}
