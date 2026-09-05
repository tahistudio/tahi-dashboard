import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { BillingContent } from './billing-content'

export const metadata = { title: 'Billing - Tahi Dashboard' }

export default async function BillingPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (isAdmin) await requirePageFeature('billing')
  return <BillingContent isAdmin={isAdmin} />
}
