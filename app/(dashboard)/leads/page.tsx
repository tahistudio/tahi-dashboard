import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { LeadsContent } from './leads-content'

export const metadata = { title: 'Leads — Tahi Dashboard' }

export default async function LeadsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')
  return <LeadsContent />
}
