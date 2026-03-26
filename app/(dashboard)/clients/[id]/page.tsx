import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ClientDetail } from './client-detail'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function ClientDetailPage({ params }: Props) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    redirect('/overview')
  }

  const { id } = await params
  return <ClientDetail clientId={id} />
}
