import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ScheduleDetail } from './schedule-detail'

export const metadata = { title: 'Schedule — Tahi Dashboard' }

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/requests')
  const { id } = await params
  return <ScheduleDetail scheduleId={id} />
}
