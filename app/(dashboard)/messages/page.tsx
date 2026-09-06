import { cookies } from 'next/headers'
import { getServerAuth } from '@/lib/server-auth'
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
 */
export default async function MessagesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  await requirePageFeature('messages')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const previewing = isAdmin && Boolean((await cookies()).get('tahi-impersonate-org')?.value)

  return (
    <MessagesContent
      audience={isAdmin && !previewing ? 'studio' : 'client'}
      readOnly={previewing}
    />
  )
}
