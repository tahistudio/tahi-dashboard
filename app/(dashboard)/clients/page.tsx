import { Suspense } from 'react'
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { ClientList } from './client-list'

export const metadata = { title: 'Clients - Tahi Dashboard' }

export default async function ClientsPage() {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  await requirePageFeature('clients')
  return (
    <Suspense>
      <ClientList />
    </Suspense>
  )
}
