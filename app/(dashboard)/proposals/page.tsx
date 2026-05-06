import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ProposalsContent } from './proposals-content'

export const metadata = { title: 'Proposals — Tahi Dashboard' }

export default async function ProposalsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/requests')
  return <ProposalsContent />
}
