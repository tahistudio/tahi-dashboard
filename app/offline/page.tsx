import { OfflineContent } from './offline-content'
import { OFFLINE_CSS } from './offline-css'

export const metadata = { title: 'Offline - Tahi Dashboard' }

/**
 * The service worker precaches this route and serves it for any navigation
 * that fails (public/sw.js). It is listed as a PUBLIC route in middleware.ts on
 * purpose: a signed-out fetch of /offline used to redirect to /sign-in, and
 * Cache.addAll rejects a redirect, so the install could fail and leave exactly
 * the people who need a fallback without one.
 *
 * The stylesheet is INLINE rather than a `./offline.css` import. The worker
 * precaches this document and nothing else, so a separate CSS chunk is only
 * ever there by luck of the HTTP cache; on a cold cache the one page that
 * exists for the offline case would render unstyled. Carrying the rules in the
 * cached HTML makes the fallback self-sufficient.
 */
export default function OfflinePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OFFLINE_CSS }} />
      <OfflineContent />
    </>
  )
}
