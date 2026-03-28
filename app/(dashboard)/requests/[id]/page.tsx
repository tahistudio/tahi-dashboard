import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { RequestDetail } from './request-detail'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const metadata = { title: 'Request Detail - Tahi Dashboard' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function RequestDetailPage({ params }: Props) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const { id } = await params
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <ErrorBoundary fallbackTitle="Request failed to load">
      <RequestDetail
        requestId={id}
        isAdmin={isAdmin}
        currentUserId={userId}
      />
    </ErrorBoundary>
  )
}
