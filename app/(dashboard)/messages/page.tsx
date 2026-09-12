import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { MessagesContent } from '@/components/tahi/messages/messages-content'
import './messages.css'

export const metadata = { title: 'Messages - Tahi Dashboard' }

/**
 * /messages : the inbox, for both audiences. One route, two branches.
 *
 * The studio branch reads /api/admin/messages (every client the caller is
 * scoped to, internal notes included, plus a client switcher). The client
 * branch reads /api/portal/messages, which is `getPortalAuth` all the way
 * down: their own org, their own brands, no internal notes, no deleted rows.
 *
 * Audience is Tahi-org MEMBERSHIP, not the impersonation cookie, exactly as
 * /notifications resolves it. What the preview changes is that an admin
 * looking through a client's eyes gets the CLIENT branch and the page goes
 * read-only: `getPortalAuth` already resolves their cookie to that client's
 * org, so the portal routes serve the client's inbox and refuse every write
 * independently. The flag below is the sentence that explains it, not the gate.
 *
 * `requirePageFeature('messages')` is the same FEATURE_TREE key both APIs
 * enforce, so a client org (or a scoped team member) Liam has switched
 * Messages off for is bounced here, hidden in the nav AND 403'd on the data.
 * Visible equals permitted on all three surfaces, never two of the three.
 *
 * CLIENT DEFAULT (2026-09-13): denied. The request thread is the client
 * channel, so a client org with no explicit allow override lands here and
 * bounces to /requests, not /overview: /requests is their actual channel,
 * exactly the way every other client-only page (schedules, contracts,
 * proposals) already sends a denied client home. An org or contact allow
 * override opts one client back in and the page renders normally for them.
 */
export default async function MessagesPage() {
  const { userId, isAdmin, isPreviewingClient, isClientAudience } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  await requirePageFeature('messages', isClientAudience ? '/requests' : '/overview')
  return (
    <MessagesContent
      audience={isAdmin && !isPreviewingClient ? 'studio' : 'client'}
      readOnly={isPreviewingClient}
    />
  )
}
