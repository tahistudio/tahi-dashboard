import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { CallsContent } from './calls-content'

export const metadata = { title: 'Calls - Tahi Dashboard' }

export default async function CallsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <CallsContent />
}
