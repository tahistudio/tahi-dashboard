import { redirect } from 'next/navigation'
import { getViewAudience } from '@/lib/view-audience'
import { requirePageFeature } from '@/lib/page-guard'
import { SiteContent } from './site-content'

export const metadata = { title: 'Site QA | Tahi Dashboard' }

export default async function QaSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface: Client view leaves it the way a real client does.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('qa_tester')
  const { siteId } = await params
  return <SiteContent siteId={siteId} />
}
