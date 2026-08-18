import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { CapacityContent } from './capacity-content'

export const metadata = { title: 'Capacity - Tahi Dashboard' }

export default async function CapacityPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  // Granular permissions: a team member denied capacity is redirected.
  await requirePageFeature('capacity')

  return <CapacityContent />
}
