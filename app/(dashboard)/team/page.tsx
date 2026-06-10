import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { TeamContent } from './team-content'

export const metadata = { title: 'Team - Tahi Dashboard' }

export default async function TeamPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  await requirePageFeature('team')

  return <TeamContent />
}
