import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { AnnouncementsContent } from './announcements-content'

export const metadata = { title: 'Announcements - Tahi Dashboard' }

export default async function AnnouncementsPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/requests')
  // Granular permissions: a team member denied announcements is redirected.
  await requirePageFeature('announcements')

  return <AnnouncementsContent />
}
