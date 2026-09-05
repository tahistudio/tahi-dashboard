import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { CapacityContent } from './capacity-content'

export const metadata = { title: 'Capacity - Tahi Dashboard' }

export default async function CapacityPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')

  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  // Granular permissions: a team member denied capacity is redirected.
  await requirePageFeature('capacity')

  return <CapacityContent />
}
