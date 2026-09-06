import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { ContentStudioContent } from './content-studio-content'

export const metadata = { title: 'Content studio — Tahi Dashboard' }

export default async function ContentStudioPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  // Granular permissions: a team member denied content_studio is redirected.
  await requirePageFeature('content_studio')
  return <ContentStudioContent />
}
