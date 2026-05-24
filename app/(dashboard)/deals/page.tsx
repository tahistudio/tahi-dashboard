import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { DealsContent } from './deals-content'

export const metadata = { title: 'Deals - Tahi Dashboard' }

export default async function DealsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')

  return <DealsContent />
}
