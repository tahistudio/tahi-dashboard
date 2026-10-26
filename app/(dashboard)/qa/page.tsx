import { redirect } from 'next/navigation'
import { getViewAudience } from '@/lib/view-audience'
import { requirePageFeature } from '@/lib/page-guard'
import { QaSitesContent } from './qa-sites-content'

export const metadata = { title: 'Site QA | Tahi Dashboard' }

export default async function QaPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface: Client view leaves it the way a real client does.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('qa_tester')
  return <QaSitesContent />
}
