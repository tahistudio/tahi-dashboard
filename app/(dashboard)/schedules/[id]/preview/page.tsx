import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ScheduleViewer } from '@/app/p/schedule/[token]/schedule-viewer'

export const metadata = {
  title: 'Schedule preview — Tahi Dashboard',
  robots: { index: false, follow: false },
}

export default async function SchedulePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  const { id } = await params
  return <ScheduleViewer previewScheduleId={id} />
}
