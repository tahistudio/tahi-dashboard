import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { BrandDetail } from './brand-detail'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Brand Detail - Tahi Dashboard' }

type Props = { params: Promise<{ id: string }> }

export default async function BrandDetailPage({ params }: Props) {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    redirect('/overview')
  }

  const { id } = await params
  return (
    <ErrorBoundary fallbackTitle="Brand failed to load">
      <BrandDetail brandId={id} />
    </ErrorBoundary>
  )
}
