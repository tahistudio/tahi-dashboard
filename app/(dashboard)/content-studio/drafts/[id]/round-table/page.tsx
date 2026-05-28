import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { RoundTableDetail } from './round-table-detail'

export const metadata = { title: 'Round table — Tahi Dashboard' }

export default async function RoundTableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')

  const { id } = await params
  return <RoundTableDetail draftId={id} />
}
