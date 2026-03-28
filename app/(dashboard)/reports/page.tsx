import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ReportsContent } from './reports-content'

export const metadata = { title: 'Reports' }

export default async function ReportsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return <ReportsContent />
}
