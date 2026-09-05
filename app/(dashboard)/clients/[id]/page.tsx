import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ClientDetail } from './client-detail'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Client Detail - Tahi Dashboard' }

type Props = {
  params: Promise<{ id: string }>
  /** ?tab= makes every door on this page linkable. */
  searchParams: Promise<{ tab?: string }>
}

export default async function ClientDetailPage({ params, searchParams }: Props) {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    redirect('/overview')
  }

  const { id } = await params
  const { tab } = await searchParams
  return (
    <ErrorBoundary fallbackTitle="Client failed to load">
      <ClientDetail clientId={id} initialTab={tab} />
    </ErrorBoundary>
  )
}
