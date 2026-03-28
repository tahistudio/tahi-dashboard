import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AutomationsContent } from './automations-content'

export const metadata = { title: 'Automations - Tahi Dashboard' }

export default async function AutomationsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <AutomationsContent />
}
