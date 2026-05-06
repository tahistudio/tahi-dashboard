import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { SchedulesContent } from './schedules-content'

export const metadata = { title: 'Schedules — Tahi Dashboard' }

export default async function SchedulesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/requests')
  return <SchedulesContent />
}
