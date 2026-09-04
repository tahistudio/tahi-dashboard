import { Suspense } from 'react'
import { getServerAuth } from '@/lib/server-auth'
import { requirePageFeature } from '@/lib/page-guard'
import { RequestList } from './request-list'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'

export const metadata = { title: 'Requests - Tahi Dashboard' }

export default async function RequestsPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  await requirePageFeature('requests')
  return (
    <Suspense fallback={<LoadingSkeleton rows={5} />}>
      <RequestList isAdmin={isAdmin} />
    </Suspense>
  )
}
