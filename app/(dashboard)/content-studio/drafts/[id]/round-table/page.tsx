import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { RoundTableDetail } from './round-table-detail'

export const metadata = { title: 'Round table — Tahi Dashboard' }

export default async function RoundTableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // another client's work. See lib/view-audience.ts.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('content_studio')

  const { id } = await params
  return <RoundTableDetail draftId={id} />
}
