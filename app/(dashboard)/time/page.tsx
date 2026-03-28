import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TimeList } from './time-list'

export const metadata = { title: 'Time Tracking - Tahi Dashboard' }

export default async function TimePage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  return <TimeList />
}
