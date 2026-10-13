import { redirect } from 'next/navigation'
import { getViewAudience } from '@/lib/view-audience'
import { requirePageFeature } from '@/lib/page-guard'
import { CallRecorderContent } from './call-recorder-content'
import { db } from '@/lib/db'
import { resolvePermissions } from '@/lib/permissions'

export const metadata = { title: 'Record call - Tahi Dashboard' }

export default async function RecordCallPage() {
  const { userId, orgId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('calls')
  let canDeleteAudio = false
  try {
    canDeleteAudio = (await resolvePermissions(await db(), { userId, orgId })).isAdmin
  } catch {
    // A failed permission read never exposes an admin-only action.
  }
  return <CallRecorderContent ownerId={userId} canDeleteAudio={canDeleteAudio} />
}
