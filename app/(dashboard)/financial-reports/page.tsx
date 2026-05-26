import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { FinancialReportsContent } from './financial-reports-content'

export const metadata = { title: 'Financial reports — Tahi Dashboard' }

export default async function FinancialReportsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <FinancialReportsContent />
}
