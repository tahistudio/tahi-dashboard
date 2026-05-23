import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { SalesAnalyticsContent } from './sales-analytics-content'

export const metadata = { title: 'Sales analytics - Tahi Dashboard' }

export default async function SalesAnalyticsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  return <SalesAnalyticsContent />
}
