import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { NotificationsContent } from '@/components/tahi/notifications/notifications-content'
import './notifications.css'

export const metadata = { title: 'Notifications - Tahi Dashboard' }

/**
 * /notifications : the full history behind the bell. Serves both audiences.
 *
 * There is no feature gate here on purpose. Notification rows are keyed on the
 * caller's own Clerk user id (never on an org), so /api/notifications is
 * self-scoping and there is nothing an org-level toggle could usefully hide:
 * an empty page is the honest answer for someone with no rows.
 *
 * Audience matches the bell (components/tahi/app-top-nav.tsx): Tahi-org
 * membership, NOT the impersonation cookie. An admin in Client view still owns
 * their own team notifications with team deep links, so flipping the route map
 * under them would point their real rows at pages the map says a client can
 * reach. The preview does get the read-only lens, because clearing a real bell
 * from a preview would be a surprise.
 */
export default async function NotificationsPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  const previewing = isPreviewingClient
  return (
    <NotificationsContent
      audience={isAdmin ? 'team' : 'client'}
      readOnly={previewing}
    />
  )
}
