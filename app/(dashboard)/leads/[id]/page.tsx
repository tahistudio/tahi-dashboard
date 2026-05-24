import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { LeadPageContent } from './lead-page-content'

export const metadata = { title: 'Lead — Tahi Dashboard' }

export default async function LeadFullPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')

  const { id } = await params
  return <LeadPageContent leadId={id} />
}
