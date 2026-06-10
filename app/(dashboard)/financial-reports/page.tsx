import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { FinancialReportsContent } from './financial-reports-content'

export const metadata = { title: 'Financial reports — Tahi Dashboard' }

export default async function FinancialReportsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  // Granular permissions: a team member denied financial_reports is redirected.
  await requirePageFeature('financial_reports')
  return <FinancialReportsContent />
}
