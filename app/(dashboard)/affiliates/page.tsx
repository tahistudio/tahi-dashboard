import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AffiliatesContent } from './affiliates-content'

export const metadata = { title: 'Affiliates - Tahi Dashboard' }

export default async function AffiliatesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <AffiliatesContent />
}
