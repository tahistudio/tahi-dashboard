import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { CronsContent } from './crons-content'

export const metadata = { title: 'Scheduled jobs - Tahi Dashboard' }

export default async function CronsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <CronsContent />
}
