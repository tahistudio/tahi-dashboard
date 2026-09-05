import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { DealsContent } from './deals-content'

export const metadata = { title: 'Deals - Tahi Dashboard' }

export default async function DealsPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')

  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')

  await requirePageFeature('deals')
  return <DealsContent />
}
