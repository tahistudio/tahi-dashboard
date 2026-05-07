import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { TemplatesContent } from './templates-content'

export const metadata = { title: 'Proposal templates - Tahi Dashboard' }

export default async function ProposalTemplatesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  return <TemplatesContent />
}
