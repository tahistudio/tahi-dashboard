import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageAnyGrant } from '@/lib/page-guard'
import { TracksContent } from './tracks-content'

export const metadata = { title: 'Track Queue - Tahi Dashboard' }

export default async function TracksPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Client view (the tahi-impersonate-org cookie) is treated as a client here,
  // so the preview cannot show one client every client's queue.
  const studio = isAdmin && !isPreviewingClient

  // Studio-only page. A client reads their lanes on their home board and on
  // /requests, so this URL bounces them the way Schedules, Contracts and
  // Proposals do rather than rendering a second, unlinked queue view.
  // The 'tracks' feature key stays in lib/feature-tree.ts: /api/portal/tracks
  // guards on it to power the client home widget.
  if (!studio) redirect('/requests')

  // Studio side is gated on holding any grant (a roleless team member sees
  // nothing).
  await requirePageAnyGrant()

  return <TracksContent isAdmin={studio} />
}
