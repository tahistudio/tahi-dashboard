import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AnnouncementsContent } from './announcements-content'

export const metadata = { title: 'Announcements - Tahi Dashboard' }

export default async function AnnouncementsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  return <AnnouncementsContent />
}
