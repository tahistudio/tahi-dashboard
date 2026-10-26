import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { ReportContent } from './report-content'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Site QA report | Tahi Dashboard' }

type Props = {
  params: Promise<{ id: string }>
}

export default async function QaRoundReportPage({ params }: Props) {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Studio-only surface: Client view leaves it the way a real client does.
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageFeature('qa_tester')

  const { id } = await params
  return <ReportContent roundId={id} />
}
