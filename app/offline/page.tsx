import { OfflineContent } from './offline-content'
import './offline.css'

export const metadata = { title: 'Offline - Tahi Dashboard' }

/**
 * The service worker precaches this route and serves it for any navigation
 * that fails (public/sw.js). It is listed as a PUBLIC route in middleware.ts on
 * purpose: a signed-out fetch of /offline used to redirect to /sign-in, and
 * Cache.addAll rejects a redirect, so the install could fail and leave exactly
 * the people who need a fallback without one.
 */
export default function OfflinePage() {
  return <OfflineContent />
}
