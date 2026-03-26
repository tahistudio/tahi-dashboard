import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { RequestDetail } from './request-detail'

interface Props {
  params: Promise<{ id: string }>
}

export default async function RequestDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <RequestDetail
      requestId={id}
      isAdmin={isAdmin}
      currentUserId={userId}
    />
  )
}
