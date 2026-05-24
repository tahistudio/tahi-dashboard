import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { DealDetail } from './deal-detail'

export const metadata = { title: 'Deal Detail - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function DealDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')

  const { id } = await params

  return <DealDetail dealId={id} />
}
