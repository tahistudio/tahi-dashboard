import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ContractDetail } from './contract-detail'

export const metadata = { title: 'Contract — Tahi Dashboard' }

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  const { id } = await params
  return <ContractDetail id={id} />
}
