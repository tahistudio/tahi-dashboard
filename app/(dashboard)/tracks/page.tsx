import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature, requirePageAnyGrant } from '@/lib/page-guard'
import { TracksContent } from './tracks-content'

export const metadata = { title: 'Track Queue - Tahi Dashboard' }

export default async function TracksPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Client view (the tahi-impersonate-org cookie) takes the client branch, so
  // the preview shows the previewed client's queue rather than every client's.
  const studio = isAdmin && !isPreviewingClient

  // 'tracks' is a client-audience feature: gate the client on it, and the
  // studio side on holding any grant (a roleless team member sees nothing).
  if (studio) await requirePageAnyGrant()
  else await requirePageFeature('tracks')

  return <TracksContent isAdmin={studio} />
}
