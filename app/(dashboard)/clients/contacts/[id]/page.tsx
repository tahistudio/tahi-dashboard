import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ContactDetail } from './contact-detail'
import { ErrorBoundary } from '@/components/tahi/error-boundary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contact Detail - Tahi Dashboard' }

type Props = { params: Promise<{ id: string }> }

export default async function ContactDetailPage({ params }: Props) {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    redirect('/overview')
  }

  const { id } = await params
  return (
    <ErrorBoundary fallbackTitle="Contact failed to load">
      <ContactDetail contactId={id} />
    </ErrorBoundary>
  )
}
